"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = require("path");
const debug_1 = __importDefault(require("debug"));
const promisify_event_1 = __importDefault(require("promisify-event"));
const events_1 = require("events");
const config_storage_1 = __importDefault(require("../dashboard/config-storage"));
const lodash_1 = require("lodash");
const bootstrapper_1 = __importDefault(require("./bootstrapper"));
const reporter_1 = __importDefault(require("../reporter"));
const task_1 = __importDefault(require("./task"));
const debug_logger_1 = __importDefault(require("../notifications/debug-logger"));
const runtime_1 = require("../errors/runtime");
const types_1 = require("../errors/types");
const type_assertions_1 = require("../errors/runtime/type-assertions");
const utils_1 = require("../errors/test-run/utils");
const detect_ffmpeg_1 = __importDefault(require("../utils/detect-ffmpeg"));
const check_file_path_1 = __importDefault(require("../utils/check-file-path"));
const handle_errors_1 = require("../utils/handle-errors");
const option_names_1 = __importDefault(require("../configuration/option-names"));
const flag_list_1 = __importDefault(require("../utils/flag-list"));
const prepare_reporters_1 = __importDefault(require("../utils/prepare-reporters"));
const load_1 = __importDefault(require("../custom-client-scripts/load"));
const utils_2 = require("../custom-client-scripts/utils");
const reporter_stream_controller_1 = __importDefault(require("./reporter-stream-controller"));
const customizable_compilers_1 = __importDefault(require("../configuration/customizable-compilers"));
const string_1 = require("../utils/string");
const is_localhost_1 = __importDefault(require("../utils/is-localhost"));
const warning_log_1 = __importDefault(require("../notifications/warning-log"));
const authentication_helper_1 = __importDefault(require("../cli/authentication-helper"));
const testcafe_browser_tools_1 = require("testcafe-browser-tools");
const is_ci_1 = __importDefault(require("is-ci"));
const remote_1 = __importDefault(require("../browser/provider/built-in/remote"));
const connection_1 = __importDefault(require("../browser/connection"));
const os_family_1 = __importDefault(require("os-family"));
const detect_display_1 = __importDefault(require("../utils/detect-display"));
const quarantine_1 = require("../utils/get-options/quarantine");
const log_entry_1 = __importDefault(require("../utils/log-entry"));
const message_bus_1 = __importDefault(require("../utils/message-bus"));
const get_env_options_1 = __importDefault(require("../dashboard/get-env-options"));
const skip_js_errors_1 = require("../utils/get-options/skip-js-errors");
const DEBUG_LOGGER = (0, debug_1.default)('testcafe:runner');
const DASHBOARD_REPORTER_NAME = 'dashboard';
class Runner extends events_1.EventEmitter {
    constructor({ proxy, browserConnectionGateway, configuration, compilerService }) {
        super();
        this._messageBus = new message_bus_1.default();
        this.proxy = proxy;
        this.bootstrapper = this._createBootstrapper(browserConnectionGateway, compilerService, this._messageBus, configuration);
        this.pendingTaskPromises = [];
        this.configuration = configuration;
        this.isCli = configuration._options && configuration._options.isCli;
        this.warningLog = new warning_log_1.default(null, warning_log_1.default.createAddWarningCallback(this._messageBus));
        this.compilerService = compilerService;
        this._options = {};
        this._hasTaskErrors = false;
        this.apiMethodWasCalled = new flag_list_1.default([
            option_names_1.default.src,
            option_names_1.default.browsers,
            option_names_1.default.reporter,
            option_names_1.default.clientScripts,
        ]);
    }
    _createBootstrapper(browserConnectionGateway, compilerService, messageBus, configuration) {
        return new bootstrapper_1.default({ browserConnectionGateway, compilerService, messageBus, configuration });
    }
    _disposeBrowserSet(browserSet) {
        return browserSet.dispose().catch(e => DEBUG_LOGGER(e));
    }
    _disposeReporters(reporters) {
        return Promise.all(reporters.map(reporter => reporter.dispose().catch(e => DEBUG_LOGGER(e))));
    }
    _disposeTestedApp(testedApp) {
        return testedApp ? testedApp.kill().catch(e => DEBUG_LOGGER(e)) : Promise.resolve();
    }
    async _disposeTaskAndRelatedAssets(task, browserSet, reporters, testedApp, runnableConfigurationId) {
        task.abort();
        task.unRegisterClientScriptRouting();
        task.clearListeners();
        this._messageBus.abort();
        await this._finalizeCompilerServiceState(task, runnableConfigurationId);
        await this._disposeAssets(browserSet, reporters, testedApp);
    }
    _disposeAssets(browserSet, reporters, testedApp) {
        return Promise.all([
            this._disposeBrowserSet(browserSet),
            this._disposeReporters(reporters),
            this._disposeTestedApp(testedApp),
        ]);
    }
    _prepareArrayParameter(array) {
        array = (0, lodash_1.flattenDeep)(array);
        if (this.isCli)
            return array.length === 0 ? void 0 : array;
        return array;
    }
    _createCancelablePromise(taskPromise) {
        const promise = taskPromise.then(({ completionPromise }) => completionPromise);
        const removeFromPending = () => (0, lodash_1.pull)(this.pendingTaskPromises, promise);
        promise
            .then(removeFromPending)
            .catch(removeFromPending);
        promise.cancel = () => taskPromise
            .then(({ cancelTask }) => cancelTask())
            .then(removeFromPending);
        this.pendingTaskPromises.push(promise);
        return promise;
    }
    async _finalizeCompilerServiceState(task, runnableConfigurationId) {
        var _a;
        if (!this.compilerService)
            return;
        await ((_a = this.compilerService) === null || _a === void 0 ? void 0 : _a.removeUnitsFromState({ runnableConfigurationId }));
        // NOTE: In some cases (browser restart, stop task on first fail, etc.),
        // the fixture contexts may not be deleted.
        // We remove all fixture context at the end of test execution to clean forgotten contexts.
        const fixtureIds = (0, lodash_1.uniq)(task.tests.map(test => test.fixture.id));
        await this.compilerService.removeFixtureCtxsFromState({ fixtureIds });
    }
    // Run task
    _getFailedTestCount(task, reporter) {
        let failedTestCount = reporter.taskInfo.testCount - reporter.taskInfo.passed;
        if (task.opts.stopOnFirstFail && !!failedTestCount)
            failedTestCount = 1;
        return failedTestCount;
    }
    async _getTaskResult(task, browserSet, reporters, testedApp, runnableConfigurationId) {
        if (!task.opts.live) {
            task.on('browser-job-done', async (job) => {
                await Promise.all(job.browserConnections.map(async (bc) => {
                    await browserSet.releaseConnection(bc);
                }));
            });
        }
        this._messageBus.clearListeners('error');
        const browserSetErrorPromise = (0, promisify_event_1.default)(browserSet, 'error');
        const taskErrorPromise = (0, promisify_event_1.default)(task, 'error');
        const messageBusErrorPromise = (0, promisify_event_1.default)(this._messageBus, 'error');
        const streamController = new reporter_stream_controller_1.default(this._messageBus, reporters);
        const taskDonePromise = this._messageBus.once('done')
            .then(() => browserSetErrorPromise.cancel())
            .then(() => {
            return Promise.all(reporters.map(reporter => reporter.taskInfo.pendingTaskDonePromise));
        });
        const promises = [
            taskDonePromise,
            browserSetErrorPromise,
            taskErrorPromise,
            messageBusErrorPromise,
        ];
        if (testedApp)
            promises.push(testedApp.errorPromise);
        try {
            await Promise.race(promises);
        }
        catch (err) {
            await this._disposeTaskAndRelatedAssets(task, browserSet, reporters, testedApp, runnableConfigurationId);
            throw err;
        }
        await this._disposeAssets(browserSet, reporters, testedApp);
        await this._finalizeCompilerServiceState(task, runnableConfigurationId);
        if (streamController.multipleStreamError)
            throw streamController.multipleStreamError;
        return this._getFailedTestCount(task, reporters[0]);
    }
    _createTask(tests, browserConnectionGroups, proxy, opts, warningLog) {
        return new task_1.default({
            tests,
            browserConnectionGroups,
            proxy,
            opts,
            runnerWarningLog: warningLog,
            compilerService: this.compilerService,
            messageBus: this._messageBus,
        });
    }
    _runTask({ reporters, browserSet, tests, testedApp, options, runnableConfigurationId }) {
        const task = this._createTask(tests, browserSet.browserConnectionGroups, this.proxy, options, this.warningLog);
        const completionPromise = this._getTaskResult(task, browserSet, reporters, testedApp, runnableConfigurationId);
        let completed = false;
        this._messageBus.on('start', handle_errors_1.startHandlingTestErrors);
        if (!this.configuration.getOption(option_names_1.default.skipUncaughtErrors)) {
            this._messageBus.on('test-run-start', handle_errors_1.addRunningTest);
            this._messageBus.on('test-run-done', ({ errs }) => {
                if (errs.length)
                    this._hasTaskErrors = true;
                (0, handle_errors_1.removeRunningTest)();
            });
        }
        this._messageBus.on('done', handle_errors_1.stopHandlingTestErrors);
        task.on('error', handle_errors_1.stopHandlingTestErrors);
        const onTaskCompleted = () => {
            task.unRegisterClientScriptRouting();
            completed = true;
        };
        completionPromise
            .then(onTaskCompleted)
            .catch(onTaskCompleted);
        const cancelTask = async () => {
            if (!completed)
                await this._disposeTaskAndRelatedAssets(task, browserSet, reporters, testedApp, runnableConfigurationId);
        };
        return { completionPromise, cancelTask };
    }
    _registerAssets(assets) {
        assets.forEach(asset => this.proxy.GET(asset.path, asset.info));
    }
    _validateDebugLogger() {
        const debugLogger = this.configuration.getOption(option_names_1.default.debugLogger);
        const debugLoggerDefinedCorrectly = debugLogger === null || !!debugLogger &&
            ['showBreakpoint', 'hideBreakpoint'].every(method => method in debugLogger && (0, lodash_1.isFunction)(debugLogger[method]));
        if (!debugLoggerDefinedCorrectly) {
            this.configuration.mergeOptions({
                [option_names_1.default.debugLogger]: debug_logger_1.default,
            });
        }
    }
    _validateSpeedOption() {
        const speed = this.configuration.getOption(option_names_1.default.speed);
        if (speed === void 0)
            return;
        if (typeof speed !== 'number' || isNaN(speed) || speed < 0.01 || speed > 1)
            throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.invalidSpeedValue);
    }
    _validateConcurrencyOption() {
        const concurrency = this.configuration.getOption(option_names_1.default.concurrency);
        if (concurrency === void 0)
            return;
        if (typeof concurrency !== 'number' || isNaN(concurrency) || concurrency < 1)
            throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.invalidConcurrencyFactor);
        if (concurrency > 1 && this.bootstrapper.browsers.some(browser => {
            return browser instanceof connection_1.default
                ? browser.browserInfo.browserOption.cdpPort
                : browser.browserOption.cdpPort;
        }))
            throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.cannotSetConcurrencyWithCDPPort);
    }
    _validateSkipJsErrorsOption() {
        const skipJsErrorsOptions = this.configuration.getOption(option_names_1.default.skipJsErrors);
        if (!skipJsErrorsOptions)
            return;
        (0, skip_js_errors_1.validateSkipJsErrorsOptionValue)(skipJsErrorsOptions, runtime_1.GeneralError);
    }
    async _validateBrowsers() {
        const browsers = this.configuration.getOption(option_names_1.default.browsers);
        if (!browsers || Array.isArray(browsers) && !browsers.length)
            throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.browserNotSet);
        if (os_family_1.default.mac)
            await this._checkRequiredPermissions(browsers);
        if (os_family_1.default.linux && !(0, detect_display_1.default)())
            await this._checkThatTestsCanRunWithoutDisplay(browsers);
    }
    _validateRequestTimeoutOption(optionName) {
        const requestTimeout = this.configuration.getOption(optionName);
        if (requestTimeout === void 0)
            return;
        (0, type_assertions_1.assertType)(type_assertions_1.is.nonNegativeNumber, null, `"${optionName}" option`, requestTimeout);
    }
    _validateProxyBypassOption() {
        let proxyBypass = this.configuration.getOption(option_names_1.default.proxyBypass);
        if (proxyBypass === void 0)
            return;
        (0, type_assertions_1.assertType)([type_assertions_1.is.string, type_assertions_1.is.array], null, 'The "proxyBypass" argument', proxyBypass);
        if (typeof proxyBypass === 'string')
            proxyBypass = [proxyBypass];
        proxyBypass = proxyBypass.reduce((arr, rules) => {
            (0, type_assertions_1.assertType)(type_assertions_1.is.string, null, 'The "proxyBypass" argument', rules);
            return arr.concat(rules.split(','));
        }, []);
        this.configuration.mergeOptions({ proxyBypass });
    }
    _getScreenshotOptions() {
        let { path, pathPattern, takeOnFails } = this.configuration.getOption(option_names_1.default.screenshots) || {};
        if (!path)
            path = this.configuration.getOption(option_names_1.default.screenshotPath);
        if (!pathPattern)
            pathPattern = this.configuration.getOption(option_names_1.default.screenshotPathPattern);
        if (!takeOnFails)
            takeOnFails = false;
        return { path, pathPattern, takeOnFails };
    }
    _validateScreenshotOptions() {
        const { path, pathPattern } = this._getScreenshotOptions();
        const disableScreenshots = this.configuration.getOption(option_names_1.default.disableScreenshots) || !path;
        this.configuration.mergeOptions({ [option_names_1.default.disableScreenshots]: disableScreenshots });
        if (disableScreenshots)
            return;
        if (path) {
            this._validateScreenshotPath(path, 'screenshots base directory path');
            this.configuration.mergeOptions({ [option_names_1.default.screenshots]: { path: (0, path_1.resolve)(path) } });
        }
        if (pathPattern) {
            this._validateScreenshotPath(pathPattern, 'screenshots path pattern');
            this.configuration.mergeOptions({ [option_names_1.default.screenshots]: { pathPattern } });
        }
    }
    async _validateVideoOptions() {
        const videoPath = this.configuration.getOption(option_names_1.default.videoPath);
        const videoEncodingOptions = this.configuration.getOption(option_names_1.default.videoEncodingOptions);
        let videoOptions = this.configuration.getOption(option_names_1.default.videoOptions);
        if (!videoPath) {
            if (videoOptions || videoEncodingOptions)
                throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.cannotSetVideoOptionsWithoutBaseVideoPathSpecified);
            return;
        }
        this.configuration.mergeOptions({ [option_names_1.default.videoPath]: (0, path_1.resolve)(videoPath) });
        if (!videoOptions) {
            videoOptions = {};
            this.configuration.mergeOptions({ [option_names_1.default.videoOptions]: videoOptions });
        }
        if (videoOptions.ffmpegPath)
            videoOptions.ffmpegPath = (0, path_1.resolve)(videoOptions.ffmpegPath);
        else
            videoOptions.ffmpegPath = await (0, detect_ffmpeg_1.default)();
        if (!videoOptions.ffmpegPath)
            throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.cannotFindFFMPEG);
    }
    _validateCompilerOptions() {
        const compilerOptions = this.configuration.getOption(option_names_1.default.compilerOptions);
        if (!compilerOptions)
            return;
        const specifiedCompilers = Object.keys(compilerOptions);
        const customizedCompilers = Object.keys(customizable_compilers_1.default);
        const wrongCompilers = specifiedCompilers.filter(compiler => !customizedCompilers.includes(compiler));
        if (!wrongCompilers.length)
            return;
        const compilerListStr = (0, string_1.getConcatenatedValuesString)(wrongCompilers, void 0, "'");
        const pluralSuffix = (0, string_1.getPluralSuffix)(wrongCompilers);
        throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.cannotCustomizeSpecifiedCompilers, compilerListStr, pluralSuffix);
    }
    _validateRetryTestPagesOption() {
        const retryTestPagesOption = this.configuration.getOption(option_names_1.default.retryTestPages);
        if (!retryTestPagesOption)
            return;
        const ssl = this.configuration.getOption(option_names_1.default.ssl);
        if (ssl)
            return;
        const hostname = this.configuration.getOption(option_names_1.default.hostname);
        if ((0, is_localhost_1.default)(hostname))
            return;
        throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.cannotEnableRetryTestPagesOption);
    }
    _validateQuarantineOptions() {
        const quarantineMode = this.configuration.getOption(option_names_1.default.quarantineMode);
        if (typeof quarantineMode === 'object')
            (0, quarantine_1.validateQuarantineOptions)(quarantineMode);
    }
    async _validateRunOptions() {
        this._validateDebugLogger();
        this._validateScreenshotOptions();
        await this._validateVideoOptions();
        this._validateSpeedOption();
        this._validateProxyBypassOption();
        this._validateCompilerOptions();
        this._validateRetryTestPagesOption();
        this._validateRequestTimeoutOption(option_names_1.default.pageRequestTimeout);
        this._validateRequestTimeoutOption(option_names_1.default.ajaxRequestTimeout);
        this._validateQuarantineOptions();
        this._validateConcurrencyOption();
        this._validateSkipJsErrorsOption();
        await this._validateBrowsers();
    }
    _createRunnableConfiguration() {
        return this.bootstrapper
            .createRunnableConfiguration()
            .then(runnableConfiguration => {
            this.emit('done-bootstrapping');
            return runnableConfiguration;
        });
    }
    _validateScreenshotPath(screenshotPath, pathType) {
        const forbiddenCharsList = (0, check_file_path_1.default)(screenshotPath);
        if (forbiddenCharsList.length)
            throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.forbiddenCharatersInScreenshotPath, screenshotPath, pathType, (0, utils_1.renderForbiddenCharsList)(forbiddenCharsList));
    }
    _setBootstrapperOptions() {
        this.configuration.prepare();
        this.configuration.notifyAboutOverriddenOptions(this.warningLog);
        this.configuration.notifyAboutDeprecatedOptions(this.warningLog);
        this.bootstrapper.sources = this.configuration.getOption(option_names_1.default.src) || this.bootstrapper.sources;
        this.bootstrapper.browsers = this.configuration.getOption(option_names_1.default.browsers) || this.bootstrapper.browsers;
        this.bootstrapper.concurrency = this.configuration.getOption(option_names_1.default.concurrency);
        this.bootstrapper.appCommand = this.configuration.getOption(option_names_1.default.appCommand) || this.bootstrapper.appCommand;
        this.bootstrapper.appInitDelay = this.configuration.getOption(option_names_1.default.appInitDelay);
        this.bootstrapper.filter = this.configuration.getOption(option_names_1.default.filter) || this.bootstrapper.filter;
        this.bootstrapper.reporters = this.configuration.getOption(option_names_1.default.reporter) || this.bootstrapper.reporters;
        this.bootstrapper.tsConfigPath = this.configuration.getOption(option_names_1.default.tsConfigPath);
        this.bootstrapper.clientScripts = this.configuration.getOption(option_names_1.default.clientScripts) || this.bootstrapper.clientScripts;
        this.bootstrapper.disableMultipleWindows = this.configuration.getOption(option_names_1.default.disableMultipleWindows);
        this.bootstrapper.proxyless = this.configuration.getOption(option_names_1.default.proxyless);
        this.bootstrapper.compilerOptions = this.configuration.getOption(option_names_1.default.compilerOptions);
        this.bootstrapper.browserInitTimeout = this.configuration.getOption(option_names_1.default.browserInitTimeout);
        this.bootstrapper.hooks = this.configuration.getOption(option_names_1.default.hooks);
        this.bootstrapper.configuration = this.configuration;
    }
    async _addDashboardReporterIfNeeded() {
        const dashboardOptions = await this._getDashboardOptions();
        let reporterOptions = this.configuration.getOption(option_names_1.default.reporter);
        // NOTE: we should send reports when sendReport is undefined
        // TODO: make this option binary instead of tri-state
        if (!dashboardOptions.token || dashboardOptions.sendReport === false)
            return;
        if (!reporterOptions)
            reporterOptions = [];
        const dashboardReporter = reporterOptions.find(reporter => reporter.name === DASHBOARD_REPORTER_NAME);
        if (!dashboardReporter)
            reporterOptions.push({ name: DASHBOARD_REPORTER_NAME, options: dashboardOptions });
        else
            dashboardReporter.options = dashboardOptions;
        this.configuration.mergeOptions({ [option_names_1.default.reporter]: reporterOptions });
    }
    _turnOnScreenshotsIfNeeded() {
        const { takeOnFails } = this._getScreenshotOptions();
        const reporterOptions = this.configuration.getOption(option_names_1.default.reporter);
        if (!takeOnFails && reporterOptions && (0, lodash_1.castArray)(reporterOptions).some(reporter => reporter.name === DASHBOARD_REPORTER_NAME))
            this.configuration.mergeOptions({ [option_names_1.default.screenshots]: { takeOnFails: true, autoTakeOnFails: true } });
    }
    async _getDashboardOptions() {
        const storageOptions = await this._loadDashboardOptionsFromStorage();
        const configOptions = this.configuration.getOption(option_names_1.default.dashboard);
        const envOptions = (0, get_env_options_1.default)();
        return (0, lodash_1.merge)({}, storageOptions, configOptions, envOptions);
    }
    async _loadDashboardOptionsFromStorage() {
        const storage = new config_storage_1.default();
        await storage.load();
        return storage.options;
    }
    async _prepareClientScripts(tests, clientScripts) {
        return Promise.all(tests.map(async (test) => {
            if (test.isLegacy)
                return;
            let loadedTestClientScripts = await (0, load_1.default)(test.clientScripts, (0, path_1.dirname)(test.testFile.filename));
            loadedTestClientScripts = clientScripts.concat(loadedTestClientScripts);
            test.clientScripts = (0, utils_2.setUniqueUrls)(loadedTestClientScripts);
        }));
    }
    async _hasLocalBrowsers(browserInfo) {
        for (const browser of browserInfo) {
            if (browser instanceof connection_1.default)
                continue;
            if (await browser.provider.isLocalBrowser(void 0, browser.browserName))
                return true;
        }
        return false;
    }
    async _checkRequiredPermissions(browserInfo) {
        const hasLocalBrowsers = await this._hasLocalBrowsers(browserInfo);
        const { error } = await (0, authentication_helper_1.default)(() => (0, testcafe_browser_tools_1.findWindow)(''), testcafe_browser_tools_1.errors.UnableToAccessScreenRecordingAPIError, {
            interactive: hasLocalBrowsers && !is_ci_1.default,
        });
        if (!error)
            return;
        if (hasLocalBrowsers)
            throw error;
        remote_1.default.canDetectLocalBrowsers = false;
    }
    async _checkThatTestsCanRunWithoutDisplay(browserInfoSource) {
        for (let browserInfo of browserInfoSource) {
            if (browserInfo instanceof connection_1.default)
                browserInfo = browserInfo.browserInfo;
            const isLocalBrowser = await browserInfo.provider.isLocalBrowser(void 0, browserInfo.browserName);
            const isHeadlessBrowser = await browserInfo.provider.isHeadlessBrowser(void 0, browserInfo.browserName);
            if (isLocalBrowser && !isHeadlessBrowser) {
                throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.cannotRunLocalNonHeadlessBrowserWithoutDisplay, browserInfo.alias);
            }
        }
    }
    async _setConfigurationOptions() {
        await this.configuration.asyncMergeOptions(this._options);
    }
    // API
    embeddingOptions(opts) {
        const { assets, TestRunCtor } = opts;
        this._registerAssets(assets);
        this._options.TestRunCtor = TestRunCtor;
        return this;
    }
    src(...sources) {
        if (this.apiMethodWasCalled.src)
            throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.multipleAPIMethodCallForbidden, option_names_1.default.src);
        this._options[option_names_1.default.src] = this._prepareArrayParameter(sources);
        this.apiMethodWasCalled.src = true;
        return this;
    }
    browsers(...browsers) {
        if (this.apiMethodWasCalled.browsers)
            throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.multipleAPIMethodCallForbidden, option_names_1.default.browsers);
        this._options.browsers = this._prepareArrayParameter(browsers);
        this.apiMethodWasCalled.browsers = true;
        return this;
    }
    concurrency(concurrency) {
        this._options.concurrency = concurrency;
        return this;
    }
    reporter(name, output) {
        if (this.apiMethodWasCalled.reporter)
            throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.multipleAPIMethodCallForbidden, option_names_1.default.reporter);
        this._options[option_names_1.default.reporter] = this._prepareArrayParameter((0, prepare_reporters_1.default)(name, output));
        this.apiMethodWasCalled.reporter = true;
        return this;
    }
    filter(filter) {
        this._options.filter = filter;
        return this;
    }
    useProxy(proxy, proxyBypass) {
        this._options.proxy = proxy;
        this._options.proxyBypass = proxyBypass;
        return this;
    }
    screenshots(...options) {
        let fullPage;
        let thumbnails;
        let [path, takeOnFails, pathPattern] = options;
        if (options.length === 1 && options[0] && typeof options[0] === 'object')
            ({ path, takeOnFails, pathPattern, fullPage, thumbnails } = options[0]);
        this._options.screenshots = { path, takeOnFails, pathPattern, fullPage, thumbnails };
        return this;
    }
    video(path, options, encodingOptions) {
        this._options[option_names_1.default.videoPath] = path;
        this._options[option_names_1.default.videoOptions] = options;
        this._options[option_names_1.default.videoEncodingOptions] = encodingOptions;
        return this;
    }
    startApp(command, initDelay) {
        this._options[option_names_1.default.appCommand] = command;
        this._options[option_names_1.default.appInitDelay] = initDelay;
        return this;
    }
    tsConfigPath(path) {
        this._options[option_names_1.default.tsConfigPath] = path;
        return this;
    }
    clientScripts(...scripts) {
        if (this.apiMethodWasCalled.clientScripts)
            throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.multipleAPIMethodCallForbidden, option_names_1.default.clientScripts);
        this._options[option_names_1.default.clientScripts] = this._prepareArrayParameter(scripts);
        this.apiMethodWasCalled.clientScripts = true;
        return this;
    }
    compilerOptions(opts) {
        this._options[option_names_1.default.compilerOptions] = opts;
        return this;
    }
    run(options = {}) {
        let reporters;
        this.apiMethodWasCalled.reset();
        this._messageBus.clearListeners();
        const messageBusErrorPromise = (0, promisify_event_1.default)(this._messageBus, 'error');
        this._options = Object.assign(this._options, options);
        const runTaskPromise = Promise.resolve()
            .then(() => this._setConfigurationOptions())
            .then(async () => {
            await this._addDashboardReporterIfNeeded();
            await this._turnOnScreenshotsIfNeeded();
        })
            .then(() => reporter_1.default.getReporterPlugins(this.configuration.getOption(option_names_1.default.reporter)))
            .then(reporterPlugins => {
            reporters = reporterPlugins.map(reporter => new reporter_1.default(reporter.plugin, this._messageBus, reporter.outStream, reporter.name));
            return Promise.all(reporters.map(reporter => reporter.init()));
        })
            .then(() => this._setBootstrapperOptions())
            .then(() => {
            (0, log_entry_1.default)(DEBUG_LOGGER, this.configuration);
            return this._validateRunOptions();
        })
            .then(() => this._createRunnableConfiguration())
            .then(async ({ browserSet, tests, testedApp, commonClientScripts, id }) => {
            var _a, _b;
            await this._prepareClientScripts(tests, commonClientScripts);
            const dashboardReporter = (_a = reporters.find(r => r.plugin.name === 'dashboard')) === null || _a === void 0 ? void 0 : _a.plugin;
            const dashboardUrl = (dashboardReporter === null || dashboardReporter === void 0 ? void 0 : dashboardReporter.getReportUrl) ? dashboardReporter.getReportUrl() : '';
            const resultOptions = Object.assign(Object.assign({}, this.configuration.getOptions()), { dashboardUrl });
            await ((_b = this.bootstrapper.compilerService) === null || _b === void 0 ? void 0 : _b.setOptions({ value: resultOptions }));
            return this._runTask({
                reporters,
                browserSet,
                tests,
                testedApp,
                options: resultOptions,
                runnableConfigurationId: id,
            });
        });
        const promises = [
            runTaskPromise,
            messageBusErrorPromise,
        ];
        return this._createCancelablePromise(Promise.race(promises));
    }
    async stop() {
        // NOTE: When taskPromise is cancelled, it is removed from
        // the pendingTaskPromises array, which leads to shifting indexes
        // towards the beginning. So, we must copy the array in order to iterate it,
        // or we can perform iteration from the end to the beginning.
        const cancellationPromises = this.pendingTaskPromises.reduceRight((result, taskPromise) => {
            result.push(taskPromise.cancel());
            return result;
        }, []);
        await Promise.all(cancellationPromises);
    }
}
exports.default = Runner;
module.exports = exports.default;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvcnVubmVyL2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7O0FBQUEsK0JBQXVEO0FBQ3ZELGtEQUEwQjtBQUMxQixzRUFBNkM7QUFDN0MsbUNBQXNDO0FBQ3RDLGlGQUFpRTtBQUVqRSxtQ0FPZ0I7QUFFaEIsa0VBQTBDO0FBQzFDLDJEQUFtQztBQUNuQyxrREFBMEI7QUFDMUIsaUZBQStEO0FBQy9ELCtDQUFpRDtBQUNqRCwyQ0FBaUQ7QUFDakQsdUVBQW1FO0FBQ25FLG9EQUFvRTtBQUNwRSwyRUFBa0Q7QUFDbEQsK0VBQXFEO0FBQ3JELDBEQUtnQztBQUVoQyxpRkFBeUQ7QUFDekQsbUVBQTBDO0FBQzFDLG1GQUEwRDtBQUMxRCx5RUFBOEQ7QUFDOUQsMERBQStEO0FBQy9ELDhGQUFvRTtBQUNwRSxxR0FBNEU7QUFDNUUsNENBQStFO0FBQy9FLHlFQUFnRDtBQUNoRCwrRUFBc0Q7QUFDdEQseUZBQWdFO0FBQ2hFLG1FQUE0RDtBQUM1RCxrREFBeUI7QUFDekIsaUZBQXdFO0FBQ3hFLHVFQUFzRDtBQUN0RCwwREFBMkI7QUFDM0IsNkVBQW9EO0FBQ3BELGdFQUE0RTtBQUM1RSxtRUFBMEM7QUFDMUMsdUVBQThDO0FBQzlDLG1GQUF5RDtBQUN6RCx3RUFBc0Y7QUFFdEYsTUFBTSxZQUFZLEdBQWMsSUFBQSxlQUFLLEVBQUMsaUJBQWlCLENBQUMsQ0FBQztBQUN6RCxNQUFNLHVCQUF1QixHQUFHLFdBQVcsQ0FBQztBQUU1QyxNQUFxQixNQUFPLFNBQVEscUJBQVk7SUFDNUMsWUFBYSxFQUFFLEtBQUssRUFBRSx3QkFBd0IsRUFBRSxhQUFhLEVBQUUsZUFBZSxFQUFFO1FBQzVFLEtBQUssRUFBRSxDQUFDO1FBRVIsSUFBSSxDQUFDLFdBQVcsR0FBVyxJQUFJLHFCQUFVLEVBQUUsQ0FBQztRQUM1QyxJQUFJLENBQUMsS0FBSyxHQUFpQixLQUFLLENBQUM7UUFD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TSxDQUFDO1FBQ2xCLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQztRQUVQLE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDO0lBQzVDLENBQUM7Q0FDSjtBQTl2QkQseUJBOHZCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHJlc29sdmUgYXMgcmVzb2x2ZVBhdGgsIGRpcm5hbWUgfSBmcm9tICdwYXRoJztcbmltcG9ydCBkZWJ1ZyBmcm9tICdkZWJ1Zyc7XG5pbXBvcnQgcHJvbWlzaWZ5RXZlbnQgZnJvbSAncHJvbWlzaWZ5LWV2ZW50JztcbmltcG9ydCB7IEV2ZW50RW1pdHRlciB9IGZyb20gJ2V2ZW50cyc7XG5pbXBvcnQgRGFzaGJvYXJkQ29uZmlnU3RvcmFnZSBmcm9tICcuLi9kYXNoYm9hcmQvY29uZmlnLXN0b3JhZ2UnO1xuXG5pbXBvcnQge1xuICAgIGZsYXR0ZW5EZWVwIGFzIGZsYXR0ZW4sXG4gICAgcHVsbCBhcyByZW1vdmUsXG4gICAgaXNGdW5jdGlvbixcbiAgICB1bmlxLFxuICAgIGNhc3RBcnJheSxcbiAgICBtZXJnZSxcbn0gZnJvbSAnbG9kYXNoJztcblxuaW1wb3J0IEJvb3RzdHJhcHBlciBmcm9tICcuL2Jvb3RzdHJhcHBlcic7XG5pbXBvcnQgUmVwb3J0ZXIgZnJvbSAnLi4vcmVwb3J0ZXInO1xuaW1wb3J0IFRhc2sgZnJvbSAnLi90YXNrJztcbmltcG9ydCBkZWZhdWx0RGVidWdMb2dnZXIgZnJvbSAnLi4vbm90aWZpY2F0aW9ucy9kZWJ1Zy1sb2dnZXInO1xuaW1wb3J0IHsgR2VuZXJhbEVycm9yIH0gZnJvbSAnLi4vZXJyb3JzL3J1bnRpbWUnO1xuaW1wb3J0IHsgUlVOVElNRV9FUlJPUlMgfSBmcm9tICcuLi9lcnJvcnMvdHlwZXMnO1xuaW1wb3J0IHsgYXNzZXJ0VHlwZSwgaXMgfSBmcm9tICcuLi9lcnJvcnMvcnVudGltZS90eXBlLWFzc2VydGlvbnMnO1xuaW1wb3J0IHsgcmVuZGVyRm9yYmlkZGVuQ2hhcnNMaXN0IH0gZnJvbSAnLi4vZXJyb3JzL3Rlc3QtcnVuL3V0aWxzJztcbmltcG9ydCBkZXRlY3RGRk1QRUcgZnJvbSAnLi4vdXRpbHMvZGV0ZWN0LWZmbXBlZyc7XG5pbXBvcnQgY2hlY2tGaWxlUGF0aCBmcm9tICcuLi91dGlscy9jaGVjay1maWxlLXBhdGgnO1xuaW1wb3J0IHtcbiAgICBhZGRSdW5uaW5nVGVzdCxcbiAgICByZW1vdmVSdW5uaW5nVGVzdCxcbiAgICBzdGFydEhhbmRsaW5nVGVzdEVycm9ycyxcbiAgICBzdG9wSGFuZGxpbmdUZXN0RXJyb3JzLFxufSBmcm9tICcuLi91dGlscy9oYW5kbGUtZXJyb3JzJztcblxuaW1wb3J0IE9QVElPTl9OQU1FUyBmcm9tICcuLi9jb25maWd1cmF0aW9uL29wdGlvbi1uYW1lcyc7XG5pbXBvcnQgRmxhZ0xpc3QgZnJvbSAnLi4vdXRpbHMvZmxhZy1saXN0JztcbmltcG9ydCBwcmVwYXJlUmVwb3J0ZXJzIGZyb20gJy4uL3V0aWxzL3ByZXBhcmUtcmVwb3J0ZXJzJztcbmltcG9ydCBsb2FkQ2xpZW50U2NyaXB0cyBmcm9tICcuLi9jdXN0b20tY2xpZW50LXNjcmlwdHMvbG9hZCc7XG5pbXBvcnQgeyBzZXRVbmlxdWVVcmxzIH0gZnJvbSAnLi4vY3VzdG9tLWNsaWVudC1zY3JpcHRzL3V0aWxzJztcbmltcG9ydCBSZXBvcnRlclN0cmVhbUNvbnRyb2xsZXIgZnJvbSAnLi9yZXBvcnRlci1zdHJlYW0tY29udHJvbGxlcic7XG5pbXBvcnQgQ3VzdG9taXphYmxlQ29tcGlsZXJzIGZyb20gJy4uL2NvbmZpZ3VyYXRpb24vY3VzdG9taXphYmxlLWNvbXBpbGVycyc7XG5pbXBvcnQgeyBnZXRDb25jYXRlbmF0ZWRWYWx1ZXNTdHJpbmcsIGdldFBsdXJhbFN1ZmZpeCB9IGZyb20gJy4uL3V0aWxzL3N0cmluZyc7XG5pbXBvcnQgaXNMb2NhbGhvc3QgZnJvbSAnLi4vdXRpbHMvaXMtbG9jYWxob3N0JztcbmltcG9ydCBXYXJuaW5nTG9nIGZyb20gJy4uL25vdGlmaWNhdGlvbnMvd2FybmluZy1sb2cnO1xuaW1wb3J0IGF1dGhlbnRpY2F0aW9uSGVscGVyIGZyb20gJy4uL2NsaS9hdXRoZW50aWNhdGlvbi1oZWxwZXInO1xuaW1wb3J0IHsgZXJyb3JzLCBmaW5kV2luZG93IH0gZnJvbSAndGVzdGNhZmUtYnJvd3Nlci10b29scyc7XG5pbXBvcnQgaXNDSSBmcm9tICdpcy1jaSc7XG5pbXBvcnQgUmVtb3RlQnJvd3NlclByb3ZpZGVyIGZyb20gJy4uL2Jyb3dzZXIvcHJvdmlkZXIvYnVpbHQtaW4vcmVtb3RlJztcbmltcG9ydCBCcm93c2VyQ29ubmVjdGlvbiBmcm9tICcuLi9icm93c2VyL2Nvbm5lY3Rpb24nO1xuaW1wb3J0IE9TIGZyb20gJ29zLWZhbWlseSc7XG5pbXBvcnQgZGV0ZWN0RGlzcGxheSBmcm9tICcuLi91dGlscy9kZXRlY3QtZGlzcGxheSc7XG5pbXBvcnQgeyB2YWxpZGF0ZVF1YXJhbnRpbmVPcHRpb25zIH0gZnJvbSAnLi4vdXRpbHMvZ2V0LW9wdGlvbnMvcXVhcmFudGluZSc7XG5pbXBvcnQgbG9nRW50cnkgZnJvbSAnLi4vdXRpbHMvbG9nLWVudHJ5JztcbmltcG9ydCBNZXNzYWdlQnVzIGZyb20gJy4uL3V0aWxzL21lc3NhZ2UtYnVzJztcbmltcG9ydCBnZXRFbnZPcHRpb25zIGZyb20gJy4uL2Rhc2hib2FyZC9nZXQtZW52LW9wdGlvbnMnO1xuaW1wb3J0IHsgdmFsaWRhdGVTa2lwSnNFcnJvcnNPcHRpb25WYWx1ZSB9IGZyb20gJy4uL3V0aWxzL2dldC1vcHRpb25zL3NraXAtanMtZXJyb3JzJztcblxuY29uc3QgREVCVUdfTE9HR0VSICAgICAgICAgICAgPSBkZWJ1ZygndGVzdGNhZmU6cnVubmVyJyk7XG5jb25zdCBEQVNIQk9BUkRfUkVQT1JURVJfTkFNRSA9ICdkYXNoYm9hcmQnO1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBSdW5uZXIgZXh0ZW5kcyBFdmVudEVtaXR0ZXIge1xuICAgIGNvbnN0cnVjdG9yICh7IHByb3h5LCBicm93c2VyQ29ubmVjdGlvbkdhdGV3YXksIGNvbmZpZ3VyYXRpb24sIGNvbXBpbGVyU2VydmljZSB9KSB7XG4gICAgICAgIHN1cGVyKCk7XG5cbiAgICAgICAgdGhpcy5fbWVzc2FnZUJ1cyAgICAgICAgID0gbmV3IE1lc3NhZ2VCdXMoKTtcbiAgICAgICAgdGhpcy5wcm94eSAgICAgICAgICAgICAgID0gcHJveHk7XG4gICAgICAgIHRoaXMuYm9vdHN0cmFwcGVyICAgICAgICA9IHRoaXMuX2NyZWF0ZUJvb3RzdHJhcHBlcihicm93c2VyQ29ubmVjdGlvbkdhdGV3YXksIGNvbXBpbGVyU2VydmljZSwgdGhpcy5fbWVzc2FnZUJ1cywgY29uZmlndXJhdGlvbik7XG4gICAgICAgIHRoaXMucGVuZGluZ1Rhc2tQcm9taXNlcyA9IFtdO1xuICAgICAgICB0aGlzLmNvbmZpZ3VyYXRpb24gICAgICAgPSBjb25maWd1cmF0aW9uO1xuICAgICAgICB0aGlzLmlzQ2xpICAgICAgICAgICAgICAgPSBjb25maWd1cmF0aW9uLl9vcHRpb25zICYmIGNvbmZpZ3VyYXRpb24uX29wdGlvbnMuaXNDbGk7XG4gICAgICAgIHRoaXMud2FybmluZ0xvZyAgICAgICAgICA9IG5ldyBXYXJuaW5nTG9nKG51bGwsIFdhcm5pbmdMb2cuY3JlYXRlQWRkV2FybmluZ0NhbGxiYWNrKHRoaXMuX21lc3NhZ2VCdXMpKTtcbiAgICAgICAgdGhpcy5jb21waWxlclNlcnZpY2UgICAgID0gY29tcGlsZXJTZXJ2aWNlO1xuICAgICAgICB0aGlzLl9vcHRpb25zICAgICAgICAgICAgPSB7fTtcbiAgICAgICAgdGhpcy5faGFzVGFza0Vycm9ycyAgICAgID0gZmFsc2U7XG5cbiAgICAgICAgdGhpcy5hcGlNZXRob2RXYXNDYWxsZWQgPSBuZXcgRmxhZ0xpc3QoW1xuICAgICAgICAgICAgT1BUSU9OX05BTUVTLnNyYyxcbiAgICAgICAgICAgIE9QVElPTl9OQU1FUy5icm93c2VycyxcbiAgICAgICAgICAgIE9QVElPTl9OQU1FUy5yZXBvcnRlcixcbiAgICAgICAgICAgIE9QVElPTl9OQU1FUy5jbGllbnRTY3JpcHRzLFxuICAgICAgICBdKTtcbiAgICB9XG5cbiAgICBfY3JlYXRlQm9vdHN0cmFwcGVyIChicm93c2VyQ29ubmVjdGlvbkdhdGV3YXksIGNvbXBpbGVyU2VydmljZSwgbWVzc2FnZUJ1cywgY29uZmlndXJhdGlvbikge1xuICAgICAgICByZXR1cm4gbmV3IEJvb3RzdHJhcHBlcih7IGJyb3dzZXJDb25uZWN0aW9uR2F0ZXdheSwgY29tcGlsZXJTZXJ2aWNlLCBtZXNzYWdlQnVzLCBjb25maWd1cmF0aW9uIH0pO1xuICAgIH1cblxuICAgIF9kaXNwb3NlQnJvd3NlclNldCAoYnJvd3NlclNldCkge1xuICAgICAgICByZXR1cm4gYnJvd3NlclNldC5kaXNwb3NlKCkuY2F0Y2goZSA9PiBERUJVR19MT0dHRVIoZSkpO1xuICAgIH1cblxuICAgIF9kaXNwb3NlUmVwb3J0ZXJzIChyZXBvcnRlcnMpIHtcbiAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKHJlcG9ydGVycy5tYXAocmVwb3J0ZXIgPT4gcmVwb3J0ZXIuZGlzcG9zZSgpLmNhdGNoKGUgPT4gREVCVUdfTE9HR0VSKGUpKSkpO1xuICAgIH1cblxuICAgIF9kaXNwb3NlVGVzdGVkQXBwICh0ZXN0ZWRBcHApIHtcbiAgICAgICAgcmV0dXJuIHRlc3RlZEFwcCA/IHRlc3RlZEFwcC5raWxsKCkuY2F0Y2goZSA9PiBERUJVR19MT0dHRVIoZSkpIDogUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuXG4gICAgYXN5bmMgX2Rpc3Bvc2VUYXNrQW5kUmVsYXRlZEFzc2V0cyAodGFzaywgYnJvd3NlclNldCwgcmVwb3J0ZXJzLCB0ZXN0ZWRBcHAsIHJ1bm5hYmxlQ29uZmlndXJhdGlvbklkKSB7XG4gICAgICAgIHRhc2suYWJvcnQoKTtcbiAgICAgICAgdGFzay51blJlZ2lzdGVyQ2xpZW50U2NyaXB0Um91dGluZygpO1xuICAgICAgICB0YXNrLmNsZWFyTGlzdGVuZXJzKCk7XG4gICAgICAgIHRoaXMuX21lc3NhZ2VCdXMuYWJvcnQoKTtcblxuICAgICAgICBhd2FpdCB0aGlzLl9maW5hbGl6ZUNvbXBpbGVyU2VydmljZVN0YXRlKHRhc2ssIHJ1bm5hYmxlQ29uZmlndXJhdGlvbklkKTtcbiAgICAgICAgYXdhaXQgdGhpcy5fZGlzcG9zZUFzc2V0cyhicm93c2VyU2V0LCByZXBvcnRlcnMsIHRlc3RlZEFwcCk7XG4gICAgfVxuXG4gICAgX2Rpc3Bvc2VBc3NldHMgKGJyb3dzZXJTZXQsIHJlcG9ydGVycywgdGVzdGVkQXBwKSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLmFsbChbXG4gICAgICAgICAgICB0aGlzLl9kaXNwb3NlQnJvd3NlclNldChicm93c2VyU2V0KSxcbiAgICAgICAgICAgIHRoaXMuX2Rpc3Bvc2VSZXBvcnRlcnMocmVwb3J0ZXJzKSxcbiAgICAgICAgICAgIHRoaXMuX2Rpc3Bvc2VUZXN0ZWRBcHAodGVzdGVkQXBwKSxcbiAgICAgICAgXSk7XG4gICAgfVxuXG4gICAgX3ByZXBhcmVBcnJheVBhcmFtZXRlciAoYXJyYXkpIHtcbiAgICAgICAgYXJyYXkgPSBmbGF0dGVuKGFycmF5KTtcblxuICAgICAgICBpZiAodGhpcy5pc0NsaSlcbiAgICAgICAgICAgIHJldHVybiBhcnJheS5sZW5ndGggPT09IDAgPyB2b2lkIDAgOiBhcnJheTtcblxuICAgICAgICByZXR1cm4gYXJyYXk7XG4gICAgfVxuXG4gICAgX2NyZWF0ZUNhbmNlbGFibGVQcm9taXNlICh0YXNrUHJvbWlzZSkge1xuICAgICAgICBjb25zdCBwcm9taXNlICAgICAgICAgICA9IHRhc2tQcm9taXNlLnRoZW4oKHsgY29tcGxldGlvblByb21pc2UgfSkgPT4gY29tcGxldGlvblByb21pc2UpO1xuICAgICAgICBjb25zdCByZW1vdmVGcm9tUGVuZGluZyA9ICgpID0+IHJlbW92ZSh0aGlzLnBlbmRpbmdUYXNrUHJvbWlzZXMsIHByb21pc2UpO1xuXG4gICAgICAgIHByb21pc2VcbiAgICAgICAgICAgIC50aGVuKHJlbW92ZUZyb21QZW5kaW5nKVxuICAgICAgICAgICAgLmNhdGNoKHJlbW92ZUZyb21QZW5kaW5nKTtcblxuICAgICAgICBwcm9taXNlLmNhbmNlbCA9ICgpID0+IHRhc2tQcm9taXNlXG4gICAgICAgICAgICAudGhlbigoeyBjYW5jZWxUYXNrIH0pID0+IGNhbmNlbFRhc2soKSlcbiAgICAgICAgICAgIC50aGVuKHJlbW92ZUZyb21QZW5kaW5nKTtcblxuICAgICAgICB0aGlzLnBlbmRpbmdUYXNrUHJvbWlzZXMucHVzaChwcm9taXNlKTtcblxuICAgICAgICByZXR1cm4gcHJvbWlzZTtcbiAgICB9XG5cbiAgICBhc3luYyBfZmluYWxpemVDb21waWxlclNlcnZpY2VTdGF0ZSAodGFzaywgcnVubmFibGVDb25maWd1cmF0aW9uSWQpIHtcbiAgICAgICAgaWYgKCF0aGlzLmNvbXBpbGVyU2VydmljZSlcbiAgICAgICAgICAgIHJldHVybjtcblxuICAgICAgICBhd2FpdCB0aGlzLmNvbXBpbGVyU2VydmljZT8ucmVtb3ZlVW5pdHNGcm9tU3RhdGUoeyBydW5uYWJsZUNvbmZpZ3VyYXRpb25JZCB9KTtcblxuICAgICAgICAvLyBOT1RFOiBJbiBzb21lIGNhc2VzIChicm93c2VyIHJlc3RhcnQsIHN0b3AgdGFzayBvbiBmaXJzdCBmYWlsLCBldGMuKSxcbiAgICAgICAgLy8gdGhlIGZpeHR1cmUgY29udGV4dHMgbWF5IG5vdCBiZSBkZWxldGVkLlxuICAgICAgICAvLyBXZSByZW1vdmUgYWxsIGZpeHR1cmUgY29udGV4dCBhdCB0aGUgZW5kIG9mIHRlc3QgZXhlY3V0aW9uIHRvIGNsZWFuIGZvcmdvdHRlbiBjb250ZXh0cy5cbiAgICAgICAgY29uc3QgZml4dHVyZUlkcyA9IHVuaXEodGFzay50ZXN0cy5tYXAodGVzdCA9PiB0ZXN0LmZpeHR1cmUuaWQpKTtcblxuICAgICAgICBhd2FpdCB0aGlzLmNvbXBpbGVyU2VydmljZS5yZW1vdmVGaXh0dXJlQ3R4c0Zyb21TdGF0ZSh7IGZpeHR1cmVJZHMgfSk7XG4gICAgfVxuXG4gICAgLy8gUnVuIHRhc2tcbiAgICBfZ2V0RmFpbGVkVGVzdENvdW50ICh0YXNrLCByZXBvcnRlcikge1xuICAgICAgICBsZXQgZmFpbGVkVGVzdENvdW50ID0gcmVwb3J0ZXIudGFza0luZm8udGVzdENvdW50IC0gcmVwb3J0ZXIudGFza0luZm8ucGFzc2VkO1xuXG4gICAgICAgIGlmICh0YXNrLm9wdHMuc3RvcE9uRmlyc3RGYWlsICYmICEhZmFpbGVkVGVzdENvdW50KVxuICAgICAgICAgICAgZmFpbGVkVGVzdENvdW50ID0gMTtcblxuICAgICAgICByZXR1cm4gZmFpbGVkVGVzdENvdW50O1xuICAgIH1cblxuICAgIGFzeW5jIF9nZXRUYXNrUmVzdWx0ICh0YXNrLCBicm93c2VyU2V0LCByZXBvcnRlcnMsIHRlc3RlZEFwcCwgcnVubmFibGVDb25maWd1cmF0aW9uSWQpIHtcbiAgICAgICAgaWYgKCF0YXNrLm9wdHMubGl2ZSkge1xuICAgICAgICAgICAgdGFzay5vbignYnJvd3Nlci1qb2ItZG9uZScsIGFzeW5jIGpvYiA9PiB7XG4gICAgICAgICAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoam9iLmJyb3dzZXJDb25uZWN0aW9ucy5tYXAoYXN5bmMgYmMgPT4ge1xuICAgICAgICAgICAgICAgICAgICBhd2FpdCBicm93c2VyU2V0LnJlbGVhc2VDb25uZWN0aW9uKGJjKTtcbiAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuX21lc3NhZ2VCdXMuY2xlYXJMaXN0ZW5lcnMoJ2Vycm9yJyk7XG5cbiAgICAgICAgY29uc3QgYnJvd3NlclNldEVycm9yUHJvbWlzZSA9IHByb21pc2lmeUV2ZW50KGJyb3dzZXJTZXQsICdlcnJvcicpO1xuICAgICAgICBjb25zdCB0YXNrRXJyb3JQcm9taXNlICAgICAgID0gcHJvbWlzaWZ5RXZlbnQodGFzaywgJ2Vycm9yJyk7XG4gICAgICAgIGNvbnN0IG1lc3NhZ2VCdXNFcnJvclByb21pc2UgPSBwcm9taXNpZnlFdmVudCh0aGlzLl9tZXNzYWdlQnVzLCAnZXJyb3InKTtcbiAgICAgICAgY29uc3Qgc3RyZWFtQ29udHJvbGxlciAgICAgICA9IG5ldyBSZXBvcnRlclN0cmVhbUNvbnRyb2xsZXIodGhpcy5fbWVzc2FnZUJ1cywgcmVwb3J0ZXJzKTtcblxuICAgICAgICBjb25zdCB0YXNrRG9uZVByb21pc2UgPSB0aGlzLl9tZXNzYWdlQnVzLm9uY2UoJ2RvbmUnKVxuICAgICAgICAgICAgLnRoZW4oKCkgPT4gYnJvd3NlclNldEVycm9yUHJvbWlzZS5jYW5jZWwoKSlcbiAgICAgICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwocmVwb3J0ZXJzLm1hcChyZXBvcnRlciA9PiByZXBvcnRlci50YXNrSW5mby5wZW5kaW5nVGFza0RvbmVQcm9taXNlKSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBwcm9taXNlcyA9IFtcbiAgICAgICAgICAgIHRhc2tEb25lUHJvbWlzZSxcbiAgICAgICAgICAgIGJyb3dzZXJTZXRFcnJvclByb21pc2UsXG4gICAgICAgICAgICB0YXNrRXJyb3JQcm9taXNlLFxuICAgICAgICAgICAgbWVzc2FnZUJ1c0Vycm9yUHJvbWlzZSxcbiAgICAgICAgXTtcblxuICAgICAgICBpZiAodGVzdGVkQXBwKVxuICAgICAgICAgICAgcHJvbWlzZXMucHVzaCh0ZXN0ZWRBcHAuZXJyb3JQcm9taXNlKTtcblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgUHJvbWlzZS5yYWNlKHByb21pc2VzKTtcbiAgICAgICAgfVxuICAgICAgICBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLl9kaXNwb3NlVGFza0FuZFJlbGF0ZWRBc3NldHModGFzaywgYnJvd3NlclNldCwgcmVwb3J0ZXJzLCB0ZXN0ZWRBcHAsIHJ1bm5hYmxlQ29uZmlndXJhdGlvbklkKTtcblxuICAgICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgdGhpcy5fZGlzcG9zZUFzc2V0cyhicm93c2VyU2V0LCByZXBvcnRlcnMsIHRlc3RlZEFwcCk7XG4gICAgICAgIGF3YWl0IHRoaXMuX2ZpbmFsaXplQ29tcGlsZXJTZXJ2aWNlU3RhdGUodGFzaywgcnVubmFibGVDb25maWd1cmF0aW9uSWQpO1xuXG4gICAgICAgIGlmIChzdHJlYW1Db250cm9sbGVyLm11bHRpcGxlU3RyZWFtRXJyb3IpXG4gICAgICAgICAgICB0aHJvdyBzdHJlYW1Db250cm9sbGVyLm11bHRpcGxlU3RyZWFtRXJyb3I7XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuX2dldEZhaWxlZFRlc3RDb3VudCh0YXNrLCByZXBvcnRlcnNbMF0pO1xuICAgIH1cblxuICAgIF9jcmVhdGVUYXNrICh0ZXN0cywgYnJvd3NlckNvbm5lY3Rpb25Hcm91cHMsIHByb3h5LCBvcHRzLCB3YXJuaW5nTG9nKSB7XG4gICAgICAgIHJldHVybiBuZXcgVGFzayh7XG4gICAgICAgICAgICB0ZXN0cyxcbiAgICAgICAgICAgIGJyb3dzZXJDb25uZWN0aW9uR3JvdXBzLFxuICAgICAgICAgICAgcHJveHksXG4gICAgICAgICAgICBvcHRzLFxuICAgICAgICAgICAgcnVubmVyV2FybmluZ0xvZzogd2FybmluZ0xvZyxcbiAgICAgICAgICAgIGNvbXBpbGVyU2VydmljZTogIHRoaXMuY29tcGlsZXJTZXJ2aWNlLFxuICAgICAgICAgICAgbWVzc2FnZUJ1czogICAgICAgdGhpcy5fbWVzc2FnZUJ1cyxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgX3J1blRhc2sgKHsgcmVwb3J0ZXJzLCBicm93c2VyU2V0LCB0ZXN0cywgdGVzdGVkQXBwLCBvcHRpb25zLCBydW5uYWJsZUNvbmZpZ3VyYXRpb25JZCB9KSB7XG4gICAgICAgIGNvbnN0IHRhc2sgICAgICAgICAgICAgID0gdGhpcy5fY3JlYXRlVGFzayh0ZXN0cywgYnJvd3NlclNldC5icm93c2VyQ29ubmVjdGlvbkdyb3VwcywgdGhpcy5wcm94eSwgb3B0aW9ucywgdGhpcy53YXJuaW5nTG9nKTtcbiAgICAgICAgY29uc3QgY29tcGxldGlvblByb21pc2UgPSB0aGlzLl9nZXRUYXNrUmVzdWx0KHRhc2ssIGJyb3dzZXJTZXQsIHJlcG9ydGVycywgdGVzdGVkQXBwLCBydW5uYWJsZUNvbmZpZ3VyYXRpb25JZCk7XG4gICAgICAgIGxldCBjb21wbGV0ZWQgICAgICAgICAgID0gZmFsc2U7XG5cbiAgICAgICAgdGhpcy5fbWVzc2FnZUJ1cy5vbignc3RhcnQnLCBzdGFydEhhbmRsaW5nVGVzdEVycm9ycyk7XG5cbiAgICAgICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0T3B0aW9uKE9QVElPTl9OQU1FUy5za2lwVW5jYXVnaHRFcnJvcnMpKSB7XG4gICAgICAgICAgICB0aGlzLl9tZXNzYWdlQnVzLm9uKCd0ZXN0LXJ1bi1zdGFydCcsIGFkZFJ1bm5pbmdUZXN0KTtcbiAgICAgICAgICAgIHRoaXMuX21lc3NhZ2VCdXMub24oJ3Rlc3QtcnVuLWRvbmUnLCAoeyBlcnJzIH0pID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoZXJycy5sZW5ndGgpXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2hhc1Rhc2tFcnJvcnMgPSB0cnVlO1xuXG4gICAgICAgICAgICAgICAgcmVtb3ZlUnVubmluZ1Rlc3QoKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5fbWVzc2FnZUJ1cy5vbignZG9uZScsIHN0b3BIYW5kbGluZ1Rlc3RFcnJvcnMpO1xuXG4gICAgICAgIHRhc2sub24oJ2Vycm9yJywgc3RvcEhhbmRsaW5nVGVzdEVycm9ycyk7XG5cbiAgICAgICAgY29uc3Qgb25UYXNrQ29tcGxldGVkID0gKCkgPT4ge1xuICAgICAgICAgICAgdGFzay51blJlZ2lzdGVyQ2xpZW50U2NyaXB0Um91dGluZygpO1xuXG4gICAgICAgICAgICBjb21wbGV0ZWQgPSB0cnVlO1xuICAgICAgICB9O1xuXG4gICAgICAgIGNvbXBsZXRpb25Qcm9taXNlXG4gICAgICAgICAgICAudGhlbihvblRhc2tDb21wbGV0ZWQpXG4gICAgICAgICAgICAuY2F0Y2gob25UYXNrQ29tcGxldGVkKTtcblxuICAgICAgICBjb25zdCBjYW5jZWxUYXNrID0gYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgaWYgKCFjb21wbGV0ZWQpXG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5fZGlzcG9zZVRhc2tBbmRSZWxhdGVkQXNzZXRzKHRhc2ssIGJyb3dzZXJTZXQsIHJlcG9ydGVycywgdGVzdGVkQXBwLCBydW5uYWJsZUNvbmZpZ3VyYXRpb25JZCk7XG4gICAgICAgIH07XG5cbiAgICAgICAgcmV0dXJuIHsgY29tcGxldGlvblByb21pc2UsIGNhbmNlbFRhc2sgfTtcbiAgICB9XG5cbiAgICBfcmVnaXN0ZXJBc3NldHMgKGFzc2V0cykge1xuICAgICAgICBhc3NldHMuZm9yRWFjaChhc3NldCA9PiB0aGlzLnByb3h5LkdFVChhc3NldC5wYXRoLCBhc3NldC5pbmZvKSk7XG4gICAgfVxuXG4gICAgX3ZhbGlkYXRlRGVidWdMb2dnZXIgKCkge1xuICAgICAgICBjb25zdCBkZWJ1Z0xvZ2dlciA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRPcHRpb24oT1BUSU9OX05BTUVTLmRlYnVnTG9nZ2VyKTtcblxuICAgICAgICBjb25zdCBkZWJ1Z0xvZ2dlckRlZmluZWRDb3JyZWN0bHkgPSBkZWJ1Z0xvZ2dlciA9PT0gbnVsbCB8fCAhIWRlYnVnTG9nZ2VyICYmXG4gICAgICAgICAgICBbJ3Nob3dCcmVha3BvaW50JywgJ2hpZGVCcmVha3BvaW50J10uZXZlcnkobWV0aG9kID0+IG1ldGhvZCBpbiBkZWJ1Z0xvZ2dlciAmJiBpc0Z1bmN0aW9uKGRlYnVnTG9nZ2VyW21ldGhvZF0pKTtcblxuICAgICAgICBpZiAoIWRlYnVnTG9nZ2VyRGVmaW5lZENvcnJlY3RseSkge1xuICAgICAgICAgICAgdGhpcy5jb25maWd1cmF0aW9uLm1lcmdlT3B0aW9ucyh7XG4gICAgICAgICAgICAgICAgW09QVElPTl9OQU1FUy5kZWJ1Z0xvZ2dlcl06IGRlZmF1bHREZWJ1Z0xvZ2dlcixcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgX3ZhbGlkYXRlU3BlZWRPcHRpb24gKCkge1xuICAgICAgICBjb25zdCBzcGVlZCA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRPcHRpb24oT1BUSU9OX05BTUVTLnNwZWVkKTtcblxuICAgICAgICBpZiAoc3BlZWQgPT09IHZvaWQgMClcbiAgICAgICAgICAgIHJldHVybjtcblxuICAgICAgICBpZiAodHlwZW9mIHNwZWVkICE9PSAnbnVtYmVyJyB8fCBpc05hTihzcGVlZCkgfHwgc3BlZWQgPCAwLjAxIHx8IHNwZWVkID4gMSlcbiAgICAgICAgICAgIHRocm93IG5ldyBHZW5lcmFsRXJyb3IoUlVOVElNRV9FUlJPUlMuaW52YWxpZFNwZWVkVmFsdWUpO1xuICAgIH1cblxuICAgIF92YWxpZGF0ZUNvbmN1cnJlbmN5T3B0aW9uICgpIHtcbiAgICAgICAgY29uc3QgY29uY3VycmVuY3kgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0T3B0aW9uKE9QVElPTl9OQU1FUy5jb25jdXJyZW5jeSk7XG5cbiAgICAgICAgaWYgKGNvbmN1cnJlbmN5ID09PSB2b2lkIDApXG4gICAgICAgICAgICByZXR1cm47XG5cbiAgICAgICAgaWYgKHR5cGVvZiBjb25jdXJyZW5jeSAhPT0gJ251bWJlcicgfHwgaXNOYU4oY29uY3VycmVuY3kpIHx8IGNvbmN1cnJlbmN5IDwgMSlcbiAgICAgICAgICAgIHRocm93IG5ldyBHZW5lcmFsRXJyb3IoUlVOVElNRV9FUlJPUlMuaW52YWxpZENvbmN1cnJlbmN5RmFjdG9yKTtcblxuICAgICAgICBpZiAoY29uY3VycmVuY3kgPiAxICYmIHRoaXMuYm9vdHN0cmFwcGVyLmJyb3dzZXJzLnNvbWUoYnJvd3NlciA9PiB7XG4gICAgICAgICAgICByZXR1cm4gYnJvd3NlciBpbnN0YW5jZW9mIEJyb3dzZXJDb25uZWN0aW9uXG4gICAgICAgICAgICAgICAgPyBicm93c2VyLmJyb3dzZXJJbmZvLmJyb3dzZXJPcHRpb24uY2RwUG9ydFxuICAgICAgICAgICAgICAgIDogYnJvd3Nlci5icm93c2VyT3B0aW9uLmNkcFBvcnQ7XG4gICAgICAgIH0pKVxuICAgICAgICAgICAgdGhyb3cgbmV3IEdlbmVyYWxFcnJvcihSVU5USU1FX0VSUk9SUy5jYW5ub3RTZXRDb25jdXJyZW5jeVdpdGhDRFBQb3J0KTtcbiAgICB9XG5cbiAgICBfdmFsaWRhdGVTa2lwSnNFcnJvcnNPcHRpb24gKCkge1xuICAgICAgICBjb25zdCBza2lwSnNFcnJvcnNPcHRpb25zID0gdGhpcy5jb25maWd1cmF0aW9uLmdldE9wdGlvbihPUFRJT05fTkFNRVMuc2tpcEpzRXJyb3JzKTtcblxuICAgICAgICBpZiAoIXNraXBKc0Vycm9yc09wdGlvbnMpXG4gICAgICAgICAgICByZXR1cm47XG5cbiAgICAgICAgdmFsaWRhdGVTa2lwSnNFcnJvcnNPcHRpb25WYWx1ZShza2lwSnNFcnJvcnNPcHRpb25zLCBHZW5lcmFsRXJyb3IpO1xuICAgIH1cblxuICAgIGFzeW5jIF92YWxpZGF0ZUJyb3dzZXJzICgpIHtcbiAgICAgICAgY29uc3QgYnJvd3NlcnMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0T3B0aW9uKE9QVElPTl9OQU1FUy5icm93c2Vycyk7XG5cbiAgICAgICAgaWYgKCFicm93c2VycyB8fCBBcnJheS5pc0FycmF5KGJyb3dzZXJzKSAmJiAhYnJvd3NlcnMubGVuZ3RoKVxuICAgICAgICAgICAgdGhyb3cgbmV3IEdlbmVyYWxFcnJvcihSVU5USU1FX0VSUk9SUy5icm93c2VyTm90U2V0KTtcblxuICAgICAgICBpZiAoT1MubWFjKVxuICAgICAgICAgICAgYXdhaXQgdGhpcy5fY2hlY2tSZXF1aXJlZFBlcm1pc3Npb25zKGJyb3dzZXJzKTtcblxuICAgICAgICBpZiAoT1MubGludXggJiYgIWRldGVjdERpc3BsYXkoKSlcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuX2NoZWNrVGhhdFRlc3RzQ2FuUnVuV2l0aG91dERpc3BsYXkoYnJvd3NlcnMpO1xuICAgIH1cblxuICAgIF92YWxpZGF0ZVJlcXVlc3RUaW1lb3V0T3B0aW9uIChvcHRpb25OYW1lKSB7XG4gICAgICAgIGNvbnN0IHJlcXVlc3RUaW1lb3V0ID0gdGhpcy5jb25maWd1cmF0aW9uLmdldE9wdGlvbihvcHRpb25OYW1lKTtcblxuICAgICAgICBpZiAocmVxdWVzdFRpbWVvdXQgPT09IHZvaWQgMClcbiAgICAgICAgICAgIHJldHVybjtcblxuICAgICAgICBhc3NlcnRUeXBlKGlzLm5vbk5lZ2F0aXZlTnVtYmVyLCBudWxsLCBgXCIke29wdGlvbk5hbWV9XCIgb3B0aW9uYCwgcmVxdWVzdFRpbWVvdXQpO1xuICAgIH1cblxuICAgIF92YWxpZGF0ZVByb3h5QnlwYXNzT3B0aW9uICgpIHtcbiAgICAgICAgbGV0IHByb3h5QnlwYXNzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldE9wdGlvbihPUFRJT05fTkFNRVMucHJveHlCeXBhc3MpO1xuXG4gICAgICAgIGlmIChwcm94eUJ5cGFzcyA9PT0gdm9pZCAwKVxuICAgICAgICAgICAgcmV0dXJuO1xuXG4gICAgICAgIGFzc2VydFR5cGUoWyBpcy5zdHJpbmcsIGlzLmFycmF5IF0sIG51bGwsICdUaGUgXCJwcm94eUJ5cGFzc1wiIGFyZ3VtZW50JywgcHJveHlCeXBhc3MpO1xuXG4gICAgICAgIGlmICh0eXBlb2YgcHJveHlCeXBhc3MgPT09ICdzdHJpbmcnKVxuICAgICAgICAgICAgcHJveHlCeXBhc3MgPSBbcHJveHlCeXBhc3NdO1xuXG4gICAgICAgIHByb3h5QnlwYXNzID0gcHJveHlCeXBhc3MucmVkdWNlKChhcnIsIHJ1bGVzKSA9PiB7XG4gICAgICAgICAgICBhc3NlcnRUeXBlKGlzLnN0cmluZywgbnVsbCwgJ1RoZSBcInByb3h5QnlwYXNzXCIgYXJndW1lbnQnLCBydWxlcyk7XG5cbiAgICAgICAgICAgIHJldHVybiBhcnIuY29uY2F0KHJ1bGVzLnNwbGl0KCcsJykpO1xuICAgICAgICB9LCBbXSk7XG5cbiAgICAgICAgdGhpcy5jb25maWd1cmF0aW9uLm1lcmdlT3B0aW9ucyh7IHByb3h5QnlwYXNzIH0pO1xuICAgIH1cblxuICAgIF9nZXRTY3JlZW5zaG90T3B0aW9ucyAoKSB7XG4gICAgICAgIGxldCB7IHBhdGgsIHBhdGhQYXR0ZXJuLCB0YWtlT25GYWlscyB9ID0gdGhpcy5jb25maWd1cmF0aW9uLmdldE9wdGlvbihPUFRJT05fTkFNRVMuc2NyZWVuc2hvdHMpIHx8IHt9O1xuXG4gICAgICAgIGlmICghcGF0aClcbiAgICAgICAgICAgIHBhdGggPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0T3B0aW9uKE9QVElPTl9OQU1FUy5zY3JlZW5zaG90UGF0aCk7XG5cbiAgICAgICAgaWYgKCFwYXRoUGF0dGVybilcbiAgICAgICAgICAgIHBhdGhQYXR0ZXJuID0gdGhpcy5jb25maWd1cmF0aW9uLmdldE9wdGlvbihPUFRJT05fTkFNRVMuc2NyZWVuc2hvdFBhdGhQYXR0ZXJuKTtcblxuICAgICAgICBpZiAoIXRha2VPbkZhaWxzKVxuICAgICAgICAgICAgdGFrZU9uRmFpbHMgPSBmYWxzZTtcblxuICAgICAgICByZXR1cm4geyBwYXRoLCBwYXRoUGF0dGVybiwgdGFrZU9uRmFpbHMgfTtcbiAgICB9XG5cbiAgICBfdmFsaWRhdGVTY3JlZW5zaG90T3B0aW9ucyAoKSB7XG4gICAgICAgIGNvbnN0IHsgcGF0aCwgcGF0aFBhdHRlcm4gfSA9IHRoaXMuX2dldFNjcmVlbnNob3RPcHRpb25zKCk7XG5cbiAgICAgICAgY29uc3QgZGlzYWJsZVNjcmVlbnNob3RzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldE9wdGlvbihPUFRJT05fTkFNRVMuZGlzYWJsZVNjcmVlbnNob3RzKSB8fCAhcGF0aDtcblxuICAgICAgICB0aGlzLmNvbmZpZ3VyYXRpb24ubWVyZ2VPcHRpb25zKHsgW09QVElPTl9OQU1FUy5kaXNhYmxlU2NyZWVuc2hvdHNdOiBkaXNhYmxlU2NyZWVuc2hvdHMgfSk7XG5cbiAgICAgICAgaWYgKGRpc2FibGVTY3JlZW5zaG90cylcbiAgICAgICAgICAgIHJldHVybjtcblxuICAgICAgICBpZiAocGF0aCkge1xuICAgICAgICAgICAgdGhpcy5fdmFsaWRhdGVTY3JlZW5zaG90UGF0aChwYXRoLCAnc2NyZWVuc2hvdHMgYmFzZSBkaXJlY3RvcnkgcGF0aCcpO1xuXG4gICAgICAgICAgICB0aGlzLmNvbmZpZ3VyYXRpb24ubWVyZ2VPcHRpb25zKHsgW09QVElPTl9OQU1FUy5zY3JlZW5zaG90c106IHsgcGF0aDogcmVzb2x2ZVBhdGgocGF0aCkgfSB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChwYXRoUGF0dGVybikge1xuICAgICAgICAgICAgdGhpcy5fdmFsaWRhdGVTY3JlZW5zaG90UGF0aChwYXRoUGF0dGVybiwgJ3NjcmVlbnNob3RzIHBhdGggcGF0dGVybicpO1xuXG4gICAgICAgICAgICB0aGlzLmNvbmZpZ3VyYXRpb24ubWVyZ2VPcHRpb25zKHsgW09QVElPTl9OQU1FUy5zY3JlZW5zaG90c106IHsgcGF0aFBhdHRlcm4gfSB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGFzeW5jIF92YWxpZGF0ZVZpZGVvT3B0aW9ucyAoKSB7XG4gICAgICAgIGNvbnN0IHZpZGVvUGF0aCAgICAgICAgICAgID0gdGhpcy5jb25maWd1cmF0aW9uLmdldE9wdGlvbihPUFRJT05fTkFNRVMudmlkZW9QYXRoKTtcbiAgICAgICAgY29uc3QgdmlkZW9FbmNvZGluZ09wdGlvbnMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0T3B0aW9uKE9QVElPTl9OQU1FUy52aWRlb0VuY29kaW5nT3B0aW9ucyk7XG5cbiAgICAgICAgbGV0IHZpZGVvT3B0aW9ucyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRPcHRpb24oT1BUSU9OX05BTUVTLnZpZGVvT3B0aW9ucyk7XG5cbiAgICAgICAgaWYgKCF2aWRlb1BhdGgpIHtcbiAgICAgICAgICAgIGlmICh2aWRlb09wdGlvbnMgfHwgdmlkZW9FbmNvZGluZ09wdGlvbnMpXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEdlbmVyYWxFcnJvcihSVU5USU1FX0VSUk9SUy5jYW5ub3RTZXRWaWRlb09wdGlvbnNXaXRob3V0QmFzZVZpZGVvUGF0aFNwZWNpZmllZCk7XG5cbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5tZXJnZU9wdGlvbnMoeyBbT1BUSU9OX05BTUVTLnZpZGVvUGF0aF06IHJlc29sdmVQYXRoKHZpZGVvUGF0aCkgfSk7XG5cbiAgICAgICAgaWYgKCF2aWRlb09wdGlvbnMpIHtcbiAgICAgICAgICAgIHZpZGVvT3B0aW9ucyA9IHt9O1xuXG4gICAgICAgICAgICB0aGlzLmNvbmZpZ3VyYXRpb24ubWVyZ2VPcHRpb25zKHsgW09QVElPTl9OQU1FUy52aWRlb09wdGlvbnNdOiB2aWRlb09wdGlvbnMgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodmlkZW9PcHRpb25zLmZmbXBlZ1BhdGgpXG4gICAgICAgICAgICB2aWRlb09wdGlvbnMuZmZtcGVnUGF0aCA9IHJlc29sdmVQYXRoKHZpZGVvT3B0aW9ucy5mZm1wZWdQYXRoKTtcbiAgICAgICAgZWxzZVxuICAgICAgICAgICAgdmlkZW9PcHRpb25zLmZmbXBlZ1BhdGggPSBhd2FpdCBkZXRlY3RGRk1QRUcoKTtcblxuICAgICAgICBpZiAoIXZpZGVvT3B0aW9ucy5mZm1wZWdQYXRoKVxuICAgICAgICAgICAgdGhyb3cgbmV3IEdlbmVyYWxFcnJvcihSVU5USU1FX0VSUk9SUy5jYW5ub3RGaW5kRkZNUEVHKTtcbiAgICB9XG5cbiAgICBfdmFsaWRhdGVDb21waWxlck9wdGlvbnMgKCkge1xuICAgICAgICBjb25zdCBjb21waWxlck9wdGlvbnMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0T3B0aW9uKE9QVElPTl9OQU1FUy5jb21waWxlck9wdGlvbnMpO1xuXG4gICAgICAgIGlmICghY29tcGlsZXJPcHRpb25zKVxuICAgICAgICAgICAgcmV0dXJuO1xuXG4gICAgICAgIGNvbnN0IHNwZWNpZmllZENvbXBpbGVycyAgPSBPYmplY3Qua2V5cyhjb21waWxlck9wdGlvbnMpO1xuICAgICAgICBjb25zdCBjdXN0b21pemVkQ29tcGlsZXJzID0gT2JqZWN0LmtleXMoQ3VzdG9taXphYmxlQ29tcGlsZXJzKTtcbiAgICAgICAgY29uc3Qgd3JvbmdDb21waWxlcnMgICAgICA9IHNwZWNpZmllZENvbXBpbGVycy5maWx0ZXIoY29tcGlsZXIgPT4gIWN1c3RvbWl6ZWRDb21waWxlcnMuaW5jbHVkZXMoY29tcGlsZXIpKTtcblxuICAgICAgICBpZiAoIXdyb25nQ29tcGlsZXJzLmxlbmd0aClcbiAgICAgICAgICAgIHJldHVybjtcblxuICAgICAgICBjb25zdCBjb21waWxlckxpc3RTdHIgPSBnZXRDb25jYXRlbmF0ZWRWYWx1ZXNTdHJpbmcod3JvbmdDb21waWxlcnMsIHZvaWQgMCwgXCInXCIpO1xuICAgICAgICBjb25zdCBwbHVyYWxTdWZmaXggICAgPSBnZXRQbHVyYWxTdWZmaXgod3JvbmdDb21waWxlcnMpO1xuXG4gICAgICAgIHRocm93IG5ldyBHZW5lcmFsRXJyb3IoUlVOVElNRV9FUlJPUlMuY2Fubm90Q3VzdG9taXplU3BlY2lmaWVkQ29tcGlsZXJzLCBjb21waWxlckxpc3RTdHIsIHBsdXJhbFN1ZmZpeCk7XG4gICAgfVxuXG4gICAgX3ZhbGlkYXRlUmV0cnlUZXN0UGFnZXNPcHRpb24gKCkge1xuICAgICAgICBjb25zdCByZXRyeVRlc3RQYWdlc09wdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRPcHRpb24oT1BUSU9OX05BTUVTLnJldHJ5VGVzdFBhZ2VzKTtcblxuICAgICAgICBpZiAoIXJldHJ5VGVzdFBhZ2VzT3B0aW9uKVxuICAgICAgICAgICAgcmV0dXJuO1xuXG4gICAgICAgIGNvbnN0IHNzbCA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRPcHRpb24oT1BUSU9OX05BTUVTLnNzbCk7XG5cbiAgICAgICAgaWYgKHNzbClcbiAgICAgICAgICAgIHJldHVybjtcblxuICAgICAgICBjb25zdCBob3N0bmFtZSA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRPcHRpb24oT1BUSU9OX05BTUVTLmhvc3RuYW1lKTtcblxuICAgICAgICBpZiAoaXNMb2NhbGhvc3QoaG9zdG5hbWUpKVxuICAgICAgICAgICAgcmV0dXJuO1xuXG4gICAgICAgIHRocm93IG5ldyBHZW5lcmFsRXJyb3IoUlVOVElNRV9FUlJPUlMuY2Fubm90RW5hYmxlUmV0cnlUZXN0UGFnZXNPcHRpb24pO1xuICAgIH1cblxuICAgIF92YWxpZGF0ZVF1YXJhbnRpbmVPcHRpb25zICgpIHtcbiAgICAgICAgY29uc3QgcXVhcmFudGluZU1vZGUgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0T3B0aW9uKE9QVElPTl9OQU1FUy5xdWFyYW50aW5lTW9kZSk7XG5cbiAgICAgICAgaWYgKHR5cGVvZiBxdWFyYW50aW5lTW9kZSA9PT0gJ29iamVjdCcpXG4gICAgICAgICAgICB2YWxpZGF0ZVF1YXJhbnRpbmVPcHRpb25zKHF1YXJhbnRpbmVNb2RlKTtcbiAgICB9XG5cbiAgICBhc3luYyBfdmFsaWRhdGVSdW5PcHRpb25zICgpIHtcbiAgICAgICAgdGhpcy5fdmFsaWRhdGVEZWJ1Z0xvZ2dlcigpO1xuICAgICAgICB0aGlzLl92YWxpZGF0ZVNjcmVlbnNob3RPcHRpb25zKCk7XG4gICAgICAgIGF3YWl0IHRoaXMuX3ZhbGlkYXRlVmlkZW9PcHRpb25zKCk7XG4gICAgICAgIHRoaXMuX3ZhbGlkYXRlU3BlZWRPcHRpb24oKTtcbiAgICAgICAgdGhpcy5fdmFsaWRhdGVQcm94eUJ5cGFzc09wdGlvbigpO1xuICAgICAgICB0aGlzLl92YWxpZGF0ZUNvbXBpbGVyT3B0aW9ucygpO1xuICAgICAgICB0aGlzLl92YWxpZGF0ZVJldHJ5VGVzdFBhZ2VzT3B0aW9uKCk7XG4gICAgICAgIHRoaXMuX3ZhbGlkYXRlUmVxdWVzdFRpbWVvdXRPcHRpb24oT1BUSU9OX05BTUVTLnBhZ2VSZXF1ZXN0VGltZW91dCk7XG4gICAgICAgIHRoaXMuX3ZhbGlkYXRlUmVxdWVzdFRpbWVvdXRPcHRpb24oT1BUSU9OX05BTUVTLmFqYXhSZXF1ZXN0VGltZW91dCk7XG4gICAgICAgIHRoaXMuX3ZhbGlkYXRlUXVhcmFudGluZU9wdGlvbnMoKTtcbiAgICAgICAgdGhpcy5fdmFsaWRhdGVDb25jdXJyZW5jeU9wdGlvbigpO1xuICAgICAgICB0aGlzLl92YWxpZGF0ZVNraXBKc0Vycm9yc09wdGlvbigpO1xuICAgICAgICBhd2FpdCB0aGlzLl92YWxpZGF0ZUJyb3dzZXJzKCk7XG4gICAgfVxuXG4gICAgX2NyZWF0ZVJ1bm5hYmxlQ29uZmlndXJhdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmJvb3RzdHJhcHBlclxuICAgICAgICAgICAgLmNyZWF0ZVJ1bm5hYmxlQ29uZmlndXJhdGlvbigpXG4gICAgICAgICAgICAudGhlbihydW5uYWJsZUNvbmZpZ3VyYXRpb24gPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuZW1pdCgnZG9uZS1ib290c3RyYXBwaW5nJyk7XG5cbiAgICAgICAgICAgICAgICByZXR1cm4gcnVubmFibGVDb25maWd1cmF0aW9uO1xuICAgICAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgX3ZhbGlkYXRlU2NyZWVuc2hvdFBhdGggKHNjcmVlbnNob3RQYXRoLCBwYXRoVHlwZSkge1xuICAgICAgICBjb25zdCBmb3JiaWRkZW5DaGFyc0xpc3QgPSBjaGVja0ZpbGVQYXRoKHNjcmVlbnNob3RQYXRoKTtcblxuICAgICAgICBpZiAoZm9yYmlkZGVuQ2hhcnNMaXN0Lmxlbmd0aClcbiAgICAgICAgICAgIHRocm93IG5ldyBHZW5lcmFsRXJyb3IoUlVOVElNRV9FUlJPUlMuZm9yYmlkZGVuQ2hhcmF0ZXJzSW5TY3JlZW5zaG90UGF0aCwgc2NyZWVuc2hvdFBhdGgsIHBhdGhUeXBlLCByZW5kZXJGb3JiaWRkZW5DaGFyc0xpc3QoZm9yYmlkZGVuQ2hhcnNMaXN0KSk7XG4gICAgfVxuXG4gICAgX3NldEJvb3RzdHJhcHBlck9wdGlvbnMgKCkge1xuICAgICAgICB0aGlzLmNvbmZpZ3VyYXRpb24ucHJlcGFyZSgpO1xuICAgICAgICB0aGlzLmNvbmZpZ3VyYXRpb24ubm90aWZ5QWJvdXRPdmVycmlkZGVuT3B0aW9ucyh0aGlzLndhcm5pbmdMb2cpO1xuICAgICAgICB0aGlzLmNvbmZpZ3VyYXRpb24ubm90aWZ5QWJvdXREZXByZWNhdGVkT3B0aW9ucyh0aGlzLndhcm5pbmdMb2cpO1xuXG4gICAgICAgIHRoaXMuYm9vdHN0cmFwcGVyLnNvdXJjZXMgICAgICAgICAgICAgICAgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0T3B0aW9uKE9QVElPTl9OQU1FUy5zcmMpIHx8IHRoaXMuYm9vdHN0cmFwcGVyLnNvdXJjZXM7XG4gICAgICAgIHRoaXMuYm9vdHN0cmFwcGVyLmJyb3dzZXJzICAgICAgICAgICAgICAgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0T3B0aW9uKE9QVElPTl9OQU1FUy5icm93c2VycykgfHwgdGhpcy5ib290c3RyYXBwZXIuYnJvd3NlcnM7XG4gICAgICAgIHRoaXMuYm9vdHN0cmFwcGVyLmNvbmN1cnJlbmN5ICAgICAgICAgICAgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0T3B0aW9uKE9QVElPTl9OQU1FUy5jb25jdXJyZW5jeSk7XG4gICAgICAgIHRoaXMuYm9vdHN0cmFwcGVyLmFwcENvbW1hbmQgICAgICAgICAgICAgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0T3B0aW9uKE9QVElPTl9OQU1FUy5hcHBDb21tYW5kKSB8fCB0aGlzLmJvb3RzdHJhcHBlci5hcHBDb21tYW5kO1xuICAgICAgICB0aGlzLmJvb3RzdHJhcHBlci5hcHBJbml0RGVsYXkgICAgICAgICAgID0gdGhpcy5jb25maWd1cmF0aW9uLmdldE9wdGlvbihPUFRJT05fTkFNRVMuYXBwSW5pdERlbGF5KTtcbiAgICAgICAgdGhpcy5ib290c3RyYXBwZXIuZmlsdGVyICAgICAgICAgICAgICAgICA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRPcHRpb24oT1BUSU9OX05BTUVTLmZpbHRlcikgfHwgdGhpcy5ib290c3RyYXBwZXIuZmlsdGVyO1xuICAgICAgICB0aGlzLmJvb3RzdHJhcHBlci5yZXBvcnRlcnMgICAgICAgICAgICAgID0gdGhpcy5jb25maWd1cmF0aW9uLmdldE9wdGlvbihPUFRJT05fTkFNRVMucmVwb3J0ZXIpIHx8IHRoaXMuYm9vdHN0cmFwcGVyLnJlcG9ydGVycztcbiAgICAgICAgdGhpcy5ib290c3RyYXBwZXIudHNDb25maWdQYXRoICAgICAgICAgICA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRPcHRpb24oT1BUSU9OX05BTUVTLnRzQ29uZmlnUGF0aCk7XG4gICAgICAgIHRoaXMuYm9vdHN0cmFwcGVyLmNsaWVudFNjcmlwdHMgICAgICAgICAgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0T3B0aW9uKE9QVElPTl9OQU1FUy5jbGllbnRTY3JpcHRzKSB8fCB0aGlzLmJvb3RzdHJhcHBlci5jbGllbnRTY3JpcHRzO1xuICAgICAgICB0aGlzLmJvb3RzdHJhcHBlci5kaXNhYmxlTXVsdGlwbGVXaW5kb3dzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldE9wdGlvbihPUFRJT05fTkFNRVMuZGlzYWJsZU11bHRpcGxlV2luZG93cyk7XG4gICAgICAgIHRoaXMuYm9vdHN0cmFwcGVyLnByb3h5bGVzcyAgICAgICAgICAgICAgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0T3B0aW9uKE9QVElPTl9OQU1FUy5wcm94eWxlc3MpO1xuICAgICAgICB0aGlzLmJvb3RzdHJhcHBlci5jb21waWxlck9wdGlvbnMgICAgICAgID0gdGhpcy5jb25maWd1cmF0aW9uLmdldE9wdGlvbihPUFRJT05fTkFNRVMuY29tcGlsZXJPcHRpb25zKTtcbiAgICAgICAgdGhpcy5ib290c3RyYXBwZXIuYnJvd3NlckluaXRUaW1lb3V0ICAgICA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRPcHRpb24oT1BUSU9OX05BTUVTLmJyb3dzZXJJbml0VGltZW91dCk7XG4gICAgICAgIHRoaXMuYm9vdHN0cmFwcGVyLmhvb2tzICAgICAgICAgICAgICAgICAgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0T3B0aW9uKE9QVElPTl9OQU1FUy5ob29rcyk7XG4gICAgICAgIHRoaXMuYm9vdHN0cmFwcGVyLmNvbmZpZ3VyYXRpb24gICAgICAgICAgPSB0aGlzLmNvbmZpZ3VyYXRpb247XG4gICAgfVxuXG4gICAgYXN5bmMgX2FkZERhc2hib2FyZFJlcG9ydGVySWZOZWVkZWQgKCkge1xuICAgICAgICBjb25zdCBkYXNoYm9hcmRPcHRpb25zID0gYXdhaXQgdGhpcy5fZ2V0RGFzaGJvYXJkT3B0aW9ucygpO1xuICAgICAgICBsZXQgcmVwb3J0ZXJPcHRpb25zICAgID0gdGhpcy5jb25maWd1cmF0aW9uLmdldE9wdGlvbihPUFRJT05fTkFNRVMucmVwb3J0ZXIpO1xuXG4gICAgICAgIC8vIE5PVEU6IHdlIHNob3VsZCBzZW5kIHJlcG9ydHMgd2hlbiBzZW5kUmVwb3J0IGlzIHVuZGVmaW5lZFxuICAgICAgICAvLyBUT0RPOiBtYWtlIHRoaXMgb3B0aW9uIGJpbmFyeSBpbnN0ZWFkIG9mIHRyaS1zdGF0ZVxuICAgICAgICBpZiAoIWRhc2hib2FyZE9wdGlvbnMudG9rZW4gfHwgZGFzaGJvYXJkT3B0aW9ucy5zZW5kUmVwb3J0ID09PSBmYWxzZSlcbiAgICAgICAgICAgIHJldHVybjtcblxuICAgICAgICBpZiAoIXJlcG9ydGVyT3B0aW9ucylcbiAgICAgICAgICAgIHJlcG9ydGVyT3B0aW9ucyA9IFtdO1xuXG4gICAgICAgIGNvbnN0IGRhc2hib2FyZFJlcG9ydGVyID0gcmVwb3J0ZXJPcHRpb25zLmZpbmQocmVwb3J0ZXIgPT4gcmVwb3J0ZXIubmFtZSA9PT0gREFTSEJPQVJEX1JFUE9SVEVSX05BTUUpO1xuXG4gICAgICAgIGlmICghZGFzaGJvYXJkUmVwb3J0ZXIpXG4gICAgICAgICAgICByZXBvcnRlck9wdGlvbnMucHVzaCh7IG5hbWU6IERBU0hCT0FSRF9SRVBPUlRFUl9OQU1FLCBvcHRpb25zOiBkYXNoYm9hcmRPcHRpb25zIH0pO1xuICAgICAgICBlbHNlXG4gICAgICAgICAgICBkYXNoYm9hcmRSZXBvcnRlci5vcHRpb25zID0gZGFzaGJvYXJkT3B0aW9ucztcblxuICAgICAgICB0aGlzLmNvbmZpZ3VyYXRpb24ubWVyZ2VPcHRpb25zKHsgW09QVElPTl9OQU1FUy5yZXBvcnRlcl06IHJlcG9ydGVyT3B0aW9ucyB9KTtcbiAgICB9XG5cbiAgICBfdHVybk9uU2NyZWVuc2hvdHNJZk5lZWRlZCAoKSB7XG4gICAgICAgIGNvbnN0IHsgdGFrZU9uRmFpbHMgfSA9IHRoaXMuX2dldFNjcmVlbnNob3RPcHRpb25zKCk7XG4gICAgICAgIGNvbnN0IHJlcG9ydGVyT3B0aW9ucyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRPcHRpb24oT1BUSU9OX05BTUVTLnJlcG9ydGVyKTtcblxuICAgICAgICBpZiAoIXRha2VPbkZhaWxzICYmIHJlcG9ydGVyT3B0aW9ucyAmJiBjYXN0QXJyYXkocmVwb3J0ZXJPcHRpb25zKS5zb21lKHJlcG9ydGVyID0+IHJlcG9ydGVyLm5hbWUgPT09IERBU0hCT0FSRF9SRVBPUlRFUl9OQU1FKSlcbiAgICAgICAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5tZXJnZU9wdGlvbnMoeyBbT1BUSU9OX05BTUVTLnNjcmVlbnNob3RzXTogeyB0YWtlT25GYWlsczogdHJ1ZSwgYXV0b1Rha2VPbkZhaWxzOiB0cnVlIH0gfSk7XG4gICAgfVxuXG4gICAgYXN5bmMgX2dldERhc2hib2FyZE9wdGlvbnMgKCkge1xuICAgICAgICBjb25zdCBzdG9yYWdlT3B0aW9ucyA9IGF3YWl0IHRoaXMuX2xvYWREYXNoYm9hcmRPcHRpb25zRnJvbVN0b3JhZ2UoKTtcbiAgICAgICAgY29uc3QgY29uZmlnT3B0aW9ucyAgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0T3B0aW9uKE9QVElPTl9OQU1FUy5kYXNoYm9hcmQpO1xuICAgICAgICBjb25zdCBlbnZPcHRpb25zICAgICA9IGdldEVudk9wdGlvbnMoKTtcblxuICAgICAgICByZXR1cm4gbWVyZ2Uoe30sIHN0b3JhZ2VPcHRpb25zLCBjb25maWdPcHRpb25zLCBlbnZPcHRpb25zKTtcbiAgICB9XG5cbiAgICBhc3luYyBfbG9hZERhc2hib2FyZE9wdGlvbnNGcm9tU3RvcmFnZSAoKSB7XG4gICAgICAgIGNvbnN0IHN0b3JhZ2UgPSBuZXcgRGFzaGJvYXJkQ29uZmlnU3RvcmFnZSgpO1xuXG4gICAgICAgIGF3YWl0IHN0b3JhZ2UubG9hZCgpO1xuXG4gICAgICAgIHJldHVybiBzdG9yYWdlLm9wdGlvbnM7XG4gICAgfVxuXG4gICAgYXN5bmMgX3ByZXBhcmVDbGllbnRTY3JpcHRzICh0ZXN0cywgY2xpZW50U2NyaXB0cykge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwodGVzdHMubWFwKGFzeW5jIHRlc3QgPT4ge1xuICAgICAgICAgICAgaWYgKHRlc3QuaXNMZWdhY3kpXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuXG4gICAgICAgICAgICBsZXQgbG9hZGVkVGVzdENsaWVudFNjcmlwdHMgPSBhd2FpdCBsb2FkQ2xpZW50U2NyaXB0cyh0ZXN0LmNsaWVudFNjcmlwdHMsIGRpcm5hbWUodGVzdC50ZXN0RmlsZS5maWxlbmFtZSkpO1xuXG4gICAgICAgICAgICBsb2FkZWRUZXN0Q2xpZW50U2NyaXB0cyA9IGNsaWVudFNjcmlwdHMuY29uY2F0KGxvYWRlZFRlc3RDbGllbnRTY3JpcHRzKTtcblxuICAgICAgICAgICAgdGVzdC5jbGllbnRTY3JpcHRzID0gc2V0VW5pcXVlVXJscyhsb2FkZWRUZXN0Q2xpZW50U2NyaXB0cyk7XG4gICAgICAgIH0pKTtcbiAgICB9XG5cbiAgICBhc3luYyBfaGFzTG9jYWxCcm93c2VycyAoYnJvd3NlckluZm8pIHtcbiAgICAgICAgZm9yIChjb25zdCBicm93c2VyIG9mIGJyb3dzZXJJbmZvKSB7XG4gICAgICAgICAgICBpZiAoYnJvd3NlciBpbnN0YW5jZW9mIEJyb3dzZXJDb25uZWN0aW9uKVxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuXG4gICAgICAgICAgICBpZiAoYXdhaXQgYnJvd3Nlci5wcm92aWRlci5pc0xvY2FsQnJvd3Nlcih2b2lkIDAsIGJyb3dzZXIuYnJvd3Nlck5hbWUpKVxuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIGFzeW5jIF9jaGVja1JlcXVpcmVkUGVybWlzc2lvbnMgKGJyb3dzZXJJbmZvKSB7XG4gICAgICAgIGNvbnN0IGhhc0xvY2FsQnJvd3NlcnMgPSBhd2FpdCB0aGlzLl9oYXNMb2NhbEJyb3dzZXJzKGJyb3dzZXJJbmZvKTtcblxuICAgICAgICBjb25zdCB7IGVycm9yIH0gPSBhd2FpdCBhdXRoZW50aWNhdGlvbkhlbHBlcihcbiAgICAgICAgICAgICgpID0+IGZpbmRXaW5kb3coJycpLFxuICAgICAgICAgICAgZXJyb3JzLlVuYWJsZVRvQWNjZXNzU2NyZWVuUmVjb3JkaW5nQVBJRXJyb3IsXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgaW50ZXJhY3RpdmU6IGhhc0xvY2FsQnJvd3NlcnMgJiYgIWlzQ0ksXG4gICAgICAgICAgICB9LFxuICAgICAgICApO1xuXG4gICAgICAgIGlmICghZXJyb3IpXG4gICAgICAgICAgICByZXR1cm47XG5cbiAgICAgICAgaWYgKGhhc0xvY2FsQnJvd3NlcnMpXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcblxuICAgICAgICBSZW1vdGVCcm93c2VyUHJvdmlkZXIuY2FuRGV0ZWN0TG9jYWxCcm93c2VycyA9IGZhbHNlO1xuICAgIH1cblxuICAgIGFzeW5jIF9jaGVja1RoYXRUZXN0c0NhblJ1bldpdGhvdXREaXNwbGF5IChicm93c2VySW5mb1NvdXJjZSkge1xuICAgICAgICBmb3IgKGxldCBicm93c2VySW5mbyBvZiBicm93c2VySW5mb1NvdXJjZSkge1xuICAgICAgICAgICAgaWYgKGJyb3dzZXJJbmZvIGluc3RhbmNlb2YgQnJvd3NlckNvbm5lY3Rpb24pXG4gICAgICAgICAgICAgICAgYnJvd3NlckluZm8gPSBicm93c2VySW5mby5icm93c2VySW5mbztcblxuICAgICAgICAgICAgY29uc3QgaXNMb2NhbEJyb3dzZXIgICAgPSBhd2FpdCBicm93c2VySW5mby5wcm92aWRlci5pc0xvY2FsQnJvd3Nlcih2b2lkIDAsIGJyb3dzZXJJbmZvLmJyb3dzZXJOYW1lKTtcbiAgICAgICAgICAgIGNvbnN0IGlzSGVhZGxlc3NCcm93c2VyID0gYXdhaXQgYnJvd3NlckluZm8ucHJvdmlkZXIuaXNIZWFkbGVzc0Jyb3dzZXIodm9pZCAwLCBicm93c2VySW5mby5icm93c2VyTmFtZSk7XG5cbiAgICAgICAgICAgIGlmIChpc0xvY2FsQnJvd3NlciAmJiAhaXNIZWFkbGVzc0Jyb3dzZXIpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgR2VuZXJhbEVycm9yKFxuICAgICAgICAgICAgICAgICAgICBSVU5USU1FX0VSUk9SUy5jYW5ub3RSdW5Mb2NhbE5vbkhlYWRsZXNzQnJvd3NlcldpdGhvdXREaXNwbGF5LFxuICAgICAgICAgICAgICAgICAgICBicm93c2VySW5mby5hbGlhcyxcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgYXN5bmMgX3NldENvbmZpZ3VyYXRpb25PcHRpb25zICgpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmFzeW5jTWVyZ2VPcHRpb25zKHRoaXMuX29wdGlvbnMpO1xuICAgIH1cblxuICAgIC8vIEFQSVxuICAgIGVtYmVkZGluZ09wdGlvbnMgKG9wdHMpIHtcbiAgICAgICAgY29uc3QgeyBhc3NldHMsIFRlc3RSdW5DdG9yIH0gPSBvcHRzO1xuXG4gICAgICAgIHRoaXMuX3JlZ2lzdGVyQXNzZXRzKGFzc2V0cyk7XG4gICAgICAgIHRoaXMuX29wdGlvbnMuVGVzdFJ1bkN0b3IgPSBUZXN0UnVuQ3RvcjtcblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICBzcmMgKC4uLnNvdXJjZXMpIHtcbiAgICAgICAgaWYgKHRoaXMuYXBpTWV0aG9kV2FzQ2FsbGVkLnNyYylcbiAgICAgICAgICAgIHRocm93IG5ldyBHZW5lcmFsRXJyb3IoUlVOVElNRV9FUlJPUlMubXVsdGlwbGVBUElNZXRob2RDYWxsRm9yYmlkZGVuLCBPUFRJT05fTkFNRVMuc3JjKTtcblxuICAgICAgICB0aGlzLl9vcHRpb25zW09QVElPTl9OQU1FUy5zcmNdID0gdGhpcy5fcHJlcGFyZUFycmF5UGFyYW1ldGVyKHNvdXJjZXMpO1xuICAgICAgICB0aGlzLmFwaU1ldGhvZFdhc0NhbGxlZC5zcmMgICAgID0gdHJ1ZTtcblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICBicm93c2VycyAoLi4uYnJvd3NlcnMpIHtcbiAgICAgICAgaWYgKHRoaXMuYXBpTWV0aG9kV2FzQ2FsbGVkLmJyb3dzZXJzKVxuICAgICAgICAgICAgdGhyb3cgbmV3IEdlbmVyYWxFcnJvcihSVU5USU1FX0VSUk9SUy5tdWx0aXBsZUFQSU1ldGhvZENhbGxGb3JiaWRkZW4sIE9QVElPTl9OQU1FUy5icm93c2Vycyk7XG5cbiAgICAgICAgdGhpcy5fb3B0aW9ucy5icm93c2VycyAgICAgICAgICAgPSB0aGlzLl9wcmVwYXJlQXJyYXlQYXJhbWV0ZXIoYnJvd3NlcnMpO1xuICAgICAgICB0aGlzLmFwaU1ldGhvZFdhc0NhbGxlZC5icm93c2VycyA9IHRydWU7XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgY29uY3VycmVuY3kgKGNvbmN1cnJlbmN5KSB7XG4gICAgICAgIHRoaXMuX29wdGlvbnMuY29uY3VycmVuY3kgPSBjb25jdXJyZW5jeTtcblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICByZXBvcnRlciAobmFtZSwgb3V0cHV0KSB7XG4gICAgICAgIGlmICh0aGlzLmFwaU1ldGhvZFdhc0NhbGxlZC5yZXBvcnRlcilcbiAgICAgICAgICAgIHRocm93IG5ldyBHZW5lcmFsRXJyb3IoUlVOVElNRV9FUlJPUlMubXVsdGlwbGVBUElNZXRob2RDYWxsRm9yYmlkZGVuLCBPUFRJT05fTkFNRVMucmVwb3J0ZXIpO1xuXG4gICAgICAgIHRoaXMuX29wdGlvbnNbT1BUSU9OX05BTUVTLnJlcG9ydGVyXSA9IHRoaXMuX3ByZXBhcmVBcnJheVBhcmFtZXRlcihwcmVwYXJlUmVwb3J0ZXJzKG5hbWUsIG91dHB1dCkpO1xuICAgICAgICB0aGlzLmFwaU1ldGhvZFdhc0NhbGxlZC5yZXBvcnRlciAgICAgPSB0cnVlO1xuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIGZpbHRlciAoZmlsdGVyKSB7XG4gICAgICAgIHRoaXMuX29wdGlvbnMuZmlsdGVyID0gZmlsdGVyO1xuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIHVzZVByb3h5IChwcm94eSwgcHJveHlCeXBhc3MpIHtcbiAgICAgICAgdGhpcy5fb3B0aW9ucy5wcm94eSAgICAgICA9IHByb3h5O1xuICAgICAgICB0aGlzLl9vcHRpb25zLnByb3h5QnlwYXNzID0gcHJveHlCeXBhc3M7XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgc2NyZWVuc2hvdHMgKC4uLm9wdGlvbnMpIHtcbiAgICAgICAgbGV0IGZ1bGxQYWdlO1xuICAgICAgICBsZXQgdGh1bWJuYWlscztcbiAgICAgICAgbGV0IFtwYXRoLCB0YWtlT25GYWlscywgcGF0aFBhdHRlcm5dID0gb3B0aW9ucztcblxuICAgICAgICBpZiAob3B0aW9ucy5sZW5ndGggPT09IDEgJiYgb3B0aW9uc1swXSAmJiB0eXBlb2Ygb3B0aW9uc1swXSA9PT0gJ29iamVjdCcpXG4gICAgICAgICAgICAoeyBwYXRoLCB0YWtlT25GYWlscywgcGF0aFBhdHRlcm4sIGZ1bGxQYWdlLCB0aHVtYm5haWxzIH0gPSBvcHRpb25zWzBdKTtcblxuICAgICAgICB0aGlzLl9vcHRpb25zLnNjcmVlbnNob3RzID0geyBwYXRoLCB0YWtlT25GYWlscywgcGF0aFBhdHRlcm4sIGZ1bGxQYWdlLCB0aHVtYm5haWxzIH07XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgdmlkZW8gKHBhdGgsIG9wdGlvbnMsIGVuY29kaW5nT3B0aW9ucykge1xuICAgICAgICB0aGlzLl9vcHRpb25zW09QVElPTl9OQU1FUy52aWRlb1BhdGhdICAgICAgICAgICAgPSBwYXRoO1xuICAgICAgICB0aGlzLl9vcHRpb25zW09QVElPTl9OQU1FUy52aWRlb09wdGlvbnNdICAgICAgICAgPSBvcHRpb25zO1xuICAgICAgICB0aGlzLl9vcHRpb25zW09QVElPTl9OQU1FUy52aWRlb0VuY29kaW5nT3B0aW9uc10gPSBlbmNvZGluZ09wdGlvbnM7XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgc3RhcnRBcHAgKGNvbW1hbmQsIGluaXREZWxheSkge1xuICAgICAgICB0aGlzLl9vcHRpb25zW09QVElPTl9OQU1FUy5hcHBDb21tYW5kXSAgID0gY29tbWFuZDtcbiAgICAgICAgdGhpcy5fb3B0aW9uc1tPUFRJT05fTkFNRVMuYXBwSW5pdERlbGF5XSA9IGluaXREZWxheTtcblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICB0c0NvbmZpZ1BhdGggKHBhdGgpIHtcbiAgICAgICAgdGhpcy5fb3B0aW9uc1tPUFRJT05fTkFNRVMudHNDb25maWdQYXRoXSA9IHBhdGg7XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgY2xpZW50U2NyaXB0cyAoLi4uc2NyaXB0cykge1xuICAgICAgICBpZiAodGhpcy5hcGlNZXRob2RXYXNDYWxsZWQuY2xpZW50U2NyaXB0cylcbiAgICAgICAgICAgIHRocm93IG5ldyBHZW5lcmFsRXJyb3IoUlVOVElNRV9FUlJPUlMubXVsdGlwbGVBUElNZXRob2RDYWxsRm9yYmlkZGVuLCBPUFRJT05fTkFNRVMuY2xpZW50U2NyaXB0cyk7XG5cbiAgICAgICAgdGhpcy5fb3B0aW9uc1tPUFRJT05fTkFNRVMuY2xpZW50U2NyaXB0c10gPSB0aGlzLl9wcmVwYXJlQXJyYXlQYXJhbWV0ZXIoc2NyaXB0cyk7XG4gICAgICAgIHRoaXMuYXBpTWV0aG9kV2FzQ2FsbGVkLmNsaWVudFNjcmlwdHMgICAgID0gdHJ1ZTtcblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICBjb21waWxlck9wdGlvbnMgKG9wdHMpIHtcbiAgICAgICAgdGhpcy5fb3B0aW9uc1tPUFRJT05fTkFNRVMuY29tcGlsZXJPcHRpb25zXSA9IG9wdHM7XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgcnVuIChvcHRpb25zID0ge30pIHtcbiAgICAgICAgbGV0IHJlcG9ydGVycztcblxuICAgICAgICB0aGlzLmFwaU1ldGhvZFdhc0NhbGxlZC5yZXNldCgpO1xuICAgICAgICB0aGlzLl9tZXNzYWdlQnVzLmNsZWFyTGlzdGVuZXJzKCk7XG5cbiAgICAgICAgY29uc3QgbWVzc2FnZUJ1c0Vycm9yUHJvbWlzZSA9IHByb21pc2lmeUV2ZW50KHRoaXMuX21lc3NhZ2VCdXMsICdlcnJvcicpO1xuXG4gICAgICAgIHRoaXMuX29wdGlvbnMgPSBPYmplY3QuYXNzaWduKHRoaXMuX29wdGlvbnMsIG9wdGlvbnMpO1xuXG4gICAgICAgIGNvbnN0IHJ1blRhc2tQcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKClcbiAgICAgICAgICAgIC50aGVuKCgpID0+IHRoaXMuX3NldENvbmZpZ3VyYXRpb25PcHRpb25zKCkpXG4gICAgICAgICAgICAudGhlbihhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5fYWRkRGFzaGJvYXJkUmVwb3J0ZXJJZk5lZWRlZCgpO1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuX3R1cm5PblNjcmVlbnNob3RzSWZOZWVkZWQoKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAudGhlbigoKSA9PiBSZXBvcnRlci5nZXRSZXBvcnRlclBsdWdpbnModGhpcy5jb25maWd1cmF0aW9uLmdldE9wdGlvbihPUFRJT05fTkFNRVMucmVwb3J0ZXIpKSlcbiAgICAgICAgICAgIC50aGVuKHJlcG9ydGVyUGx1Z2lucyA9PiB7XG4gICAgICAgICAgICAgICAgcmVwb3J0ZXJzID0gcmVwb3J0ZXJQbHVnaW5zLm1hcChyZXBvcnRlciA9PiBuZXcgUmVwb3J0ZXIocmVwb3J0ZXIucGx1Z2luLCB0aGlzLl9tZXNzYWdlQnVzLCByZXBvcnRlci5vdXRTdHJlYW0sIHJlcG9ydGVyLm5hbWUpKTtcblxuICAgICAgICAgICAgICAgIHJldHVybiBQcm9taXNlLmFsbChyZXBvcnRlcnMubWFwKHJlcG9ydGVyID0+IHJlcG9ydGVyLmluaXQoKSkpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC50aGVuKCgpID0+IHRoaXMuX3NldEJvb3RzdHJhcHBlck9wdGlvbnMoKSlcbiAgICAgICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICAgICAgICBsb2dFbnRyeShERUJVR19MT0dHRVIsIHRoaXMuY29uZmlndXJhdGlvbik7XG5cbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5fdmFsaWRhdGVSdW5PcHRpb25zKCk7XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy5fY3JlYXRlUnVubmFibGVDb25maWd1cmF0aW9uKCkpXG4gICAgICAgICAgICAudGhlbihhc3luYyAoeyBicm93c2VyU2V0LCB0ZXN0cywgdGVzdGVkQXBwLCBjb21tb25DbGllbnRTY3JpcHRzLCBpZCB9KSA9PiB7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5fcHJlcGFyZUNsaWVudFNjcmlwdHModGVzdHMsIGNvbW1vbkNsaWVudFNjcmlwdHMpO1xuXG4gICAgICAgICAgICAgICAgY29uc3QgZGFzaGJvYXJkUmVwb3J0ZXIgPSByZXBvcnRlcnMuZmluZChyID0+IHIucGx1Z2luLm5hbWUgPT09ICdkYXNoYm9hcmQnKT8ucGx1Z2luO1xuICAgICAgICAgICAgICAgIGNvbnN0IGRhc2hib2FyZFVybCAgICAgID0gZGFzaGJvYXJkUmVwb3J0ZXI/LmdldFJlcG9ydFVybCA/IGRhc2hib2FyZFJlcG9ydGVyLmdldFJlcG9ydFVybCgpIDogJyc7XG5cbiAgICAgICAgICAgICAgICBjb25zdCByZXN1bHRPcHRpb25zID0ge1xuICAgICAgICAgICAgICAgICAgICAuLi50aGlzLmNvbmZpZ3VyYXRpb24uZ2V0T3B0aW9ucygpLFxuXG4gICAgICAgICAgICAgICAgICAgIGRhc2hib2FyZFVybCxcbiAgICAgICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5ib290c3RyYXBwZXIuY29tcGlsZXJTZXJ2aWNlPy5zZXRPcHRpb25zKHsgdmFsdWU6IHJlc3VsdE9wdGlvbnMgfSk7XG5cbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5fcnVuVGFzayh7XG4gICAgICAgICAgICAgICAgICAgIHJlcG9ydGVycyxcbiAgICAgICAgICAgICAgICAgICAgYnJvd3NlclNldCxcbiAgICAgICAgICAgICAgICAgICAgdGVzdHMsXG4gICAgICAgICAgICAgICAgICAgIHRlc3RlZEFwcCxcbiAgICAgICAgICAgICAgICAgICAgb3B0aW9uczogICAgICAgICAgICAgICAgIHJlc3VsdE9wdGlvbnMsXG4gICAgICAgICAgICAgICAgICAgIHJ1bm5hYmxlQ29uZmlndXJhdGlvbklkOiBpZCxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHByb21pc2VzID0gW1xuICAgICAgICAgICAgcnVuVGFza1Byb21pc2UsXG4gICAgICAgICAgICBtZXNzYWdlQnVzRXJyb3JQcm9taXNlLFxuICAgICAgICBdO1xuXG4gICAgICAgIHJldHVybiB0aGlzLl9jcmVhdGVDYW5jZWxhYmxlUHJvbWlzZShQcm9taXNlLnJhY2UocHJvbWlzZXMpKTtcbiAgICB9XG5cbiAgICBhc3luYyBzdG9wICgpIHtcbiAgICAgICAgLy8gTk9URTogV2hlbiB0YXNrUHJvbWlzZSBpcyBjYW5jZWxsZWQsIGl0IGlzIHJlbW92ZWQgZnJvbVxuICAgICAgICAvLyB0aGUgcGVuZGluZ1Rhc2tQcm9taXNlcyBhcnJheSwgd2hpY2ggbGVhZHMgdG8gc2hpZnRpbmcgaW5kZXhlc1xuICAgICAgICAvLyB0b3dhcmRzIHRoZSBiZWdpbm5pbmcuIFNvLCB3ZSBtdXN0IGNvcHkgdGhlIGFycmF5IGluIG9yZGVyIHRvIGl0ZXJhdGUgaXQsXG4gICAgICAgIC8vIG9yIHdlIGNhbiBwZXJmb3JtIGl0ZXJhdGlvbiBmcm9tIHRoZSBlbmQgdG8gdGhlIGJlZ2lubmluZy5cbiAgICAgICAgY29uc3QgY2FuY2VsbGF0aW9uUHJvbWlzZXMgPSB0aGlzLnBlbmRpbmdUYXNrUHJvbWlzZXMucmVkdWNlUmlnaHQoKHJlc3VsdCwgdGFza1Byb21pc2UpID0+IHtcbiAgICAgICAgICAgIHJlc3VsdC5wdXNoKHRhc2tQcm9taXNlLmNhbmNlbCgpKTtcblxuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgfSwgW10pO1xuXG4gICAgICAgIGF3YWl0IFByb21pc2UuYWxsKGNhbmNlbGxhdGlvblByb21pc2VzKTtcbiAgICB9XG59XG4iXX0=