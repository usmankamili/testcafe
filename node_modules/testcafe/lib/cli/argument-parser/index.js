"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const lodash_1 = require("lodash");
const commander_1 = __importStar(require("commander"));
const dedent_1 = __importDefault(require("dedent"));
const runtime_1 = require("../../errors/runtime");
const types_1 = require("../../errors/types");
const type_assertions_1 = require("../../errors/runtime/type-assertions");
const get_viewport_width_1 = __importDefault(require("../../utils/get-viewport-width"));
const string_1 = require("../../utils/string");
const get_options_1 = require("../../utils/get-options");
const get_filter_fn_1 = __importDefault(require("../../utils/get-filter-fn"));
const screenshot_option_names_1 = __importDefault(require("../../configuration/screenshot-option-names"));
const run_option_names_1 = __importDefault(require("../../configuration/run-option-names"));
const quarantine_option_names_1 = __importDefault(require("../../configuration/quarantine-option-names"));
const node_arguments_filter_1 = require("../node-arguments-filter");
const get_testcafe_version_1 = __importDefault(require("../../utils/get-testcafe-version"));
const parse_utils_1 = require("./parse-utils");
const command_names_1 = __importDefault(require("./command-names"));
const skip_js_errors_option_names_1 = require("../../configuration/skip-js-errors-option-names");
const REMOTE_ALIAS_RE = /^remote(?::(\d*))?$/;
const DESCRIPTION = (0, dedent_1.default)(`
    In the browser list, you can use browser names (e.g. "ie", "chrome", etc.) as well as paths to executables.

    To run tests against all installed browsers, use the "all" alias.

    To use a remote browser connection (e.g., to connect a mobile device), specify "remote" as the browser alias.
    If you need to connect multiple devices, add a colon and the number of browsers you want to connect (e.g., "remote:3").

    To run tests in a browser accessed through a browser provider plugin, specify a browser alias that consists of two parts - the browser provider name prefix and the name of the browser itself; for example, "saucelabs:chrome@51".

    You can use one or more file paths or glob patterns to specify which tests to run.

    More info: https://devexpress.github.io/testcafe/documentation
`);
class CLIArgumentParser {
    constructor(cwd) {
        this.cwd = cwd || process.cwd();
        this.remoteCount = 0;
        this.opts = {};
        this.args = [];
        this.isDashboardCommand = false;
        this.testCafeCommand = this._addTestCafeCommand();
        this._patchHelpOutput(this.testCafeCommand);
        CLIArgumentParser._setupRootCommand();
    }
    static _setupRootCommand() {
        // NOTE: We are forced to set the name of the root command to 'testcafe'
        // to avoid the automatic command name calculation using the executed file path.
        // It's necessary to correct command description for nested commands.
        commander_1.default.name(command_names_1.default.TestCafe);
    }
    static _removeCommandIfExists(name) {
        // NOTE: Bug in the 'commander' module.
        // It's possible to add a few commands with the same name.
        // Also, removing is a better than conditionally adding
        // because it allows avoiding the parsed option duplicates.
        const index = commander_1.default.commands.findIndex(cmd => cmd.name() === name);
        if (index > -1)
            commander_1.default.commands.splice(index, 1);
    }
    static _getDescription() {
        // NOTE: add empty line to workaround commander-forced indentation on the first line.
        return '\n' + (0, string_1.wordWrap)(DESCRIPTION, 2, (0, get_viewport_width_1.default)(process.stdout));
    }
    _addTestCafeCommand() {
        CLIArgumentParser._removeCommandIfExists(command_names_1.default.TestCafe);
        return commander_1.default
            .command(command_names_1.default.TestCafe, { isDefault: true })
            .version((0, get_testcafe_version_1.default)(), '-v, --version')
            .usage('[options] <comma-separated-browser-list> <file-or-glob ...>')
            .description(CLIArgumentParser._getDescription())
            .allowUnknownOption()
            .option('-b, --list-browsers [provider]', 'output the aliases for local browsers or browsers available through the specified browser provider')
            .option('-r, --reporter <name[:outputFile][,...]>', 'specify the reporters and optionally files where reports are saved')
            .option('-s, --screenshots <option=value[,...]>', 'specify screenshot options')
            .option('-S, --screenshots-on-fails', 'take a screenshot whenever a test fails')
            .option('-p, --screenshot-path-pattern <pattern>', 'use patterns to compose screenshot file names and paths: ${BROWSER}, ${BROWSER_VERSION}, ${OS}, etc.')
            .option('-q, --quarantine-mode [option=value,...]', 'enable quarantine mode and (optionally) modify quarantine mode settings')
            .option('-d, --debug-mode', 'execute test steps one by one pausing the test after each step')
            .option('-e, --skip-js-errors [option=value,...]', 'ignore JavaScript errors that match the specified criteria')
            .option('-u, --skip-uncaught-errors', 'ignore uncaught errors and unhandled promise rejections, which occur during test execution')
            .option('-t, --test <name>', 'run only tests with the specified name')
            .option('-T, --test-grep <pattern>', 'run only tests matching the specified pattern')
            .option('-f, --fixture <name>', 'run only fixtures with the specified name')
            .option('-F, --fixture-grep <pattern>', 'run only fixtures matching the specified pattern')
            .option('-a, --app <command>', 'launch the tested app using the specified command before running tests')
            .option('-c, --concurrency <number>', 'run tests concurrently')
            .option('-L, --live', 'enable live mode. In this mode, TestCafe watches for changes you make in the test files. These changes immediately restart the tests so that you can see the effect.')
            .option('--test-meta <key=value[,key2=value2,...]>', 'run only tests with matching metadata')
            .option('--fixture-meta <key=value[,key2=value2,...]>', 'run only fixtures with matching metadata')
            .option('--debug-on-fail', 'pause the test if it fails')
            .option('--app-init-delay <ms>', 'specify how much time it takes for the tested app to initialize')
            .option('--selector-timeout <ms>', 'specify the time within which selectors make attempts to obtain a node to be returned')
            .option('--assertion-timeout <ms>', 'specify the time within which assertion should pass')
            .option('--page-load-timeout <ms>', 'specify the time within which TestCafe waits for the `window.load` event to fire on page load before proceeding to the next test action')
            .option('--page-request-timeout <ms>', "specifies the timeout in milliseconds to complete the request for the page's HTML")
            .option('--ajax-request-timeout <ms>', 'specifies the timeout in milliseconds to complete the AJAX requests (XHR or fetch)')
            .option('--browser-init-timeout <ms>', 'specify the time (in milliseconds) TestCafe waits for the browser to start')
            .option('--test-execution-timeout <ms>', 'specify the time (in milliseconds) TestCafe waits for the test executed')
            .option('--run-execution-timeout <ms>', 'specify the time (in milliseconds) TestCafe waits for the all test executed')
            .option('--speed <factor>', 'set the speed of test execution (0.01 ... 1)')
            .option('--ports <port1,port2>', 'specify custom port numbers')
            .option('--hostname <name>', 'specify the hostname')
            .option('--proxy <host>', 'specify the host of the proxy server')
            .option('--proxy-bypass <rules>', 'specify a comma-separated list of rules that define URLs accessed bypassing the proxy server')
            .option('--ssl <options>', 'specify SSL options to run TestCafe proxy server over the HTTPS protocol')
            .option('--video <path>', 'record videos of test runs')
            .option('--video-options <option=value[,...]>', 'specify video recording options')
            .option('--video-encoding-options <option=value[,...]>', 'specify encoding options')
            .option('--dev', 'enables mechanisms to log and diagnose errors')
            .option('--qr-code', 'outputs QR-code that repeats URLs used to connect the remote browsers')
            .option('--sf, --stop-on-first-fail', 'stop an entire test run if any test fails')
            .option('--config-file <path>', 'specify a custom path to the testcafe configuration file')
            .option('--ts-config-path <path>', 'use a custom TypeScript configuration file and specify its location')
            .option('--cs, --client-scripts <paths>', 'inject scripts into tested pages', parse_utils_1.parseList, [])
            .option('--disable-page-caching', 'disable page caching during test execution')
            .option('--disable-page-reloads', 'disable page reloads between tests')
            .option('--retry-test-pages', 'retry network requests to test pages during test execution')
            .option('--disable-screenshots', 'disable screenshots')
            .option('--screenshots-full-page', 'enable full-page screenshots')
            .option('--compiler-options <option=value[,...]>', 'specify test file compiler options')
            .option('--disable-multiple-windows', 'disable multiple windows mode')
            .option('--disable-http2', 'disable the HTTP/2 proxy backend and force the proxy to use only HTTP/1.1 requests')
            .option('--cache', 'cache web assets between test runs')
            .option('--base-url <url>', 'set the base url for all tests')
            // NOTE: these options will be handled by chalk internally
            .option('--color', 'force colors in command line')
            .option('--no-color', 'disable colors in command line')
            // NOTE: temporary hide experimental options from --help command
            .addOption(new commander_1.Option('--proxyless', 'experimental').hideHelp())
            .addOption(new commander_1.Option('--experimental-debug', 'enable experimental debug mode').hideHelp())
            .action((opts) => {
            this.opts = opts;
        });
    }
    _patchHelpOutput(defaultSubCommand) {
        // NOTE: In the future versions of the 'commander' module
        // need to investigate how to remove this hack.
        commander_1.default.outputHelp = function () {
            const storedParent = defaultSubCommand.parent;
            defaultSubCommand.parent = null;
            defaultSubCommand.outputHelp();
            defaultSubCommand.parent = storedParent;
        };
    }
    _checkAndCountRemotes(browser) {
        const remoteMatch = browser.match(REMOTE_ALIAS_RE);
        if (remoteMatch) {
            this.remoteCount += parseInt(remoteMatch[1], 10) || 1;
            return false;
        }
        return true;
    }
    async _parseFilteringOptions() {
        if (this.opts.testGrep)
            this.opts.testGrep = (0, get_options_1.getGrepOptions)('--test-grep', this.opts.testGrep);
        if (this.opts.fixtureGrep)
            this.opts.fixtureGrep = (0, get_options_1.getGrepOptions)('--fixture-grep', this.opts.fixtureGrep);
        if (this.opts.testMeta)
            this.opts.testMeta = await (0, get_options_1.getMetaOptions)('--test-meta', this.opts.testMeta);
        if (this.opts.fixtureMeta)
            this.opts.fixtureMeta = await (0, get_options_1.getMetaOptions)('--fixture-meta', this.opts.fixtureMeta);
        this.opts.filter = (0, get_filter_fn_1.default)(this.opts);
    }
    _parseAppInitDelay() {
        if (this.opts.appInitDelay) {
            (0, type_assertions_1.assertType)(type_assertions_1.is.nonNegativeNumberString, null, 'The tested app initialization delay', this.opts.appInitDelay);
            this.opts.appInitDelay = parseInt(this.opts.appInitDelay, 10);
        }
    }
    _parseSelectorTimeout() {
        if (this.opts.selectorTimeout) {
            (0, type_assertions_1.assertType)(type_assertions_1.is.nonNegativeNumberString, null, 'The Selector timeout', this.opts.selectorTimeout);
            this.opts.selectorTimeout = parseInt(this.opts.selectorTimeout, 10);
        }
    }
    _parseAssertionTimeout() {
        if (this.opts.assertionTimeout) {
            (0, type_assertions_1.assertType)(type_assertions_1.is.nonNegativeNumberString, null, 'The assertion timeout', this.opts.assertionTimeout);
            this.opts.assertionTimeout = parseInt(this.opts.assertionTimeout, 10);
        }
    }
    _parsePageLoadTimeout() {
        if (this.opts.pageLoadTimeout) {
            (0, type_assertions_1.assertType)(type_assertions_1.is.nonNegativeNumberString, null, 'The page load timeout', this.opts.pageLoadTimeout);
            this.opts.pageLoadTimeout = parseInt(this.opts.pageLoadTimeout, 10);
        }
    }
    _parsePageRequestTimeout() {
        if (!this.opts.pageRequestTimeout)
            return;
        (0, type_assertions_1.assertType)(type_assertions_1.is.nonNegativeNumberString, null, 'The page request timeout', this.opts.pageRequestTimeout);
        this.opts.pageRequestTimeout = parseInt(this.opts.pageRequestTimeout, 10);
    }
    _parseAjaxRequestTimeout() {
        if (!this.opts.ajaxRequestTimeout)
            return;
        (0, type_assertions_1.assertType)(type_assertions_1.is.nonNegativeNumberString, null, 'The AJAX request timeout', this.opts.ajaxRequestTimeout);
        this.opts.ajaxRequestTimeout = parseInt(this.opts.ajaxRequestTimeout, 10);
    }
    _parseBrowserInitTimeout() {
        if (!this.opts.browserInitTimeout)
            return;
        (0, type_assertions_1.assertType)(type_assertions_1.is.nonNegativeNumberString, null, 'The browser initialization timeout', this.opts.browserInitTimeout);
        this.opts.browserInitTimeout = parseInt(this.opts.browserInitTimeout, 10);
    }
    _parseTestExecutionTimeout() {
        if (this.opts.testExecutionTimeout) {
            (0, type_assertions_1.assertType)(type_assertions_1.is.nonNegativeNumberString, null, 'The test execution timeout', this.opts.testExecutionTimeout);
            this.opts.testExecutionTimeout = parseInt(this.opts.testExecutionTimeout, 10);
        }
    }
    _parseRunExecutionTimeout() {
        if (this.opts.runExecutionTimeout) {
            (0, type_assertions_1.assertType)(type_assertions_1.is.nonNegativeNumberString, null, 'The run execution timeout', this.opts.runExecutionTimeout);
            this.opts.runExecutionTimeout = parseInt(this.opts.runExecutionTimeout, 10);
        }
    }
    _parseSpeed() {
        if (this.opts.speed)
            this.opts.speed = parseFloat(this.opts.speed);
    }
    _parseConcurrency() {
        if (this.opts.concurrency)
            this.opts.concurrency = parseInt(this.opts.concurrency, 10);
    }
    async _parseQuarantineOptions() {
        if (this.opts.quarantineMode)
            this.opts.quarantineMode = await (0, get_options_1.getQuarantineOptions)('--quarantine-mode', this.opts.quarantineMode);
    }
    async _parseSkipJsErrorsOptions() {
        if (this.opts.skipJsErrors)
            this.opts.skipJsErrors = await (0, get_options_1.getSkipJsErrorsOptions)('--skip-js-errors', this.opts.skipJsErrors);
    }
    _parsePorts() {
        if (this.opts.ports) {
            const parsedPorts = this.opts.ports /* eslint-disable-line no-extra-parens */
                .split(',')
                .map(parse_utils_1.parsePortNumber);
            if (parsedPorts.length < 2)
                throw new runtime_1.GeneralError(types_1.RUNTIME_ERRORS.portsOptionRequiresTwoNumbers);
            this.opts.ports = parsedPorts;
        }
    }
    _parseBrowsersFromArgs() {
        const browsersArg = this.testCafeCommand.args[0] || '';
        this.opts.browsers = (0, string_1.splitQuotedText)(browsersArg, ',')
            .filter(browser => browser && this._checkAndCountRemotes(browser));
    }
    async _parseSslOptions() {
        if (this.opts.ssl)
            this.opts.ssl = await (0, get_options_1.getSSLOptions)(this.opts.ssl);
    }
    async _parseReporters() {
        const reporters = this.opts.reporter ? this.opts.reporter.split(',') : []; /* eslint-disable-line no-extra-parens*/
        this.opts.reporter = reporters.map((reporter) => {
            const separatorIndex = reporter.indexOf(':');
            if (separatorIndex < 0)
                return { name: reporter };
            const name = reporter.substring(0, separatorIndex);
            const output = reporter.substring(separatorIndex + 1);
            return { name, output };
        });
    }
    _parseFileList() {
        this.opts.src = this.testCafeCommand.args.slice(1);
    }
    async _parseScreenshotOptions() {
        if (this.opts.screenshots)
            this.opts.screenshots = await (0, get_options_1.getScreenshotOptions)(this.opts.screenshots);
        else
            this.opts.screenshots = {};
        if (!(0, lodash_1.has)(this.opts.screenshots, screenshot_option_names_1.default.pathPattern) && this.opts.screenshotPathPattern)
            this.opts.screenshots[screenshot_option_names_1.default.pathPattern] = this.opts.screenshotPathPattern;
        if (!(0, lodash_1.has)(this.opts.screenshots, screenshot_option_names_1.default.takeOnFails) && this.opts.screenshotsOnFails)
            this.opts.screenshots[screenshot_option_names_1.default.takeOnFails] = this.opts.screenshotsOnFails;
    }
    async _parseVideoOptions() {
        if (this.opts.videoOptions)
            this.opts.videoOptions = await (0, get_options_1.getVideoOptions)(this.opts.videoOptions);
        if (this.opts.videoEncodingOptions)
            this.opts.videoEncodingOptions = await (0, get_options_1.getVideoOptions)(this.opts.videoEncodingOptions);
    }
    async _parseCompilerOptions() {
        if (!this.opts.compilerOptions)
            return;
        const parsedCompilerOptions = await (0, get_options_1.getCompilerOptions)(this.opts.compilerOptions);
        const resultCompilerOptions = Object.create(null);
        for (const [key, value] of Object.entries(parsedCompilerOptions))
            (0, lodash_1.set)(resultCompilerOptions, key, value);
        this.opts.compilerOptions = resultCompilerOptions;
    }
    async _parseDashboardOptions() {
        if (this.opts.dashboardOptions)
            this.opts.dashboardOptions = await (0, get_options_1.getDashboardOptions)(this.opts.dashboardOptions);
    }
    _parseListBrowsers() {
        const listBrowserOption = this.opts.listBrowsers;
        this.opts.listBrowsers = !!this.opts.listBrowsers;
        if (!this.opts.listBrowsers)
            return;
        this.opts.providerName = typeof listBrowserOption === 'string' ? listBrowserOption : 'locally-installed';
    }
    static _prepareBooleanOrObjectOption(argv, optionNames, subOptionsNames) {
        // NOTE: move options to the end of the array to correctly parse both Boolean and Object type arguments (GH-6231)
        const optionIndex = argv.findIndex(el => optionNames.some(opt => el.startsWith(opt)));
        if (optionIndex > -1) {
            const isNotLastOption = optionIndex < argv.length - 1;
            const shouldMoveOptionToEnd = isNotLastOption &&
                !subOptionsNames.some(opt => argv[optionIndex + 1].startsWith(opt));
            if (shouldMoveOptionToEnd)
                argv.push(argv.splice(optionIndex, 1)[0]);
        }
    }
    async parse(argv) {
        CLIArgumentParser._prepareBooleanOrObjectOption(argv, ['-q', '--quarantine-mode'], Object.values(quarantine_option_names_1.default));
        CLIArgumentParser._prepareBooleanOrObjectOption(argv, ['-e', '--skip-js-errors'], Object.values(skip_js_errors_option_names_1.SKIP_JS_ERRORS_OPTIONS_OBJECT_OPTION_NAMES));
        const { args, v8Flags } = (0, node_arguments_filter_1.extractNodeProcessArguments)(argv);
        commander_1.default.parse(args);
        this.args = commander_1.default.args;
        this.opts = Object.assign(this.opts, { v8Flags });
        this._parseListBrowsers();
        // NOTE: the '--list-browsers' option only lists browsers and immediately exits the app.
        // Therefore, we don't need to process other arguments.
        if (this.opts.listBrowsers)
            return;
        this._parseSelectorTimeout();
        this._parseAssertionTimeout();
        this._parsePageLoadTimeout();
        this._parsePageRequestTimeout();
        this._parseAjaxRequestTimeout();
        this._parseBrowserInitTimeout();
        this._parseTestExecutionTimeout();
        this._parseRunExecutionTimeout();
        this._parseAppInitDelay();
        this._parseSpeed();
        this._parsePorts();
        this._parseBrowsersFromArgs();
        this._parseConcurrency();
        this._parseFileList();
        await this._parseFilteringOptions();
        await this._parseQuarantineOptions();
        await this._parseSkipJsErrorsOptions();
        await this._parseScreenshotOptions();
        await this._parseVideoOptions();
        await this._parseCompilerOptions();
        await this._parseSslOptions();
        await this._parseReporters();
        await this._parseDashboardOptions();
    }
    getRunOptions() {
        const result = Object.create(null);
        run_option_names_1.default.forEach(optionName => {
            if (optionName in this.opts)
                // @ts-ignore a hack to add an index signature to interface
                result[optionName] = this.opts[optionName];
        });
        return result;
    }
}
exports.default = CLIArgumentParser;
module.exports = exports.default;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY2xpL2FyZ3VtZW50LXBhcnNlci9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsbUNBQWtDO0FBRWxDLHVEQUdtQjtBQUVuQixvREFBNEI7QUFDNUIsa0RBQW9EO0FBQ3BELDhDQUFvRDtBQUNwRCwwRUFBc0U7QUFDdEUsd0ZBQThEO0FBQzlELCtDQUErRDtBQUMvRCx5REFVaUM7QUFFakMsOEVBQW9EO0FBQ3BELDBHQUFrRjtBQUNsRiw0RkFBb0U7QUFNcEUsMEdBQWtGO0FBQ2xGLG9FQUF1RTtBQUN2RSw0RkFBa0U7QUFDbEUsK0NBQTJEO0FBQzNELG9FQUE0QztBQUU1QyxpR0FBNkc7QUFFN0csTUFBTSxlQUFlLEdBQUcscUJBQXFCLENBQUM7QUFFOUMsTUFBTSxXQUFXLEdBQUcsSUFBQSxnQkFBTSxFQUFDOzs7Ozs7Ozs7Ozs7O0NBYTFCLENBQUMsQ0FBQztBQXlDSCxNQUFxQixpQkFBaUI7SUFTbEMsWUFBb0IsR0FBWTtRQUM1QixJQUFJLENBQUMsR0FBRyxHQUFXLEdBQUcsSUFBSSxPQUFPLENBQUMsR0FBRyxFQUFFLENBQUM7UUFDeEMsSUFBSSxDQUFDLFdBQVcsR0FBRyxDQUFDLENBQUM7UUFDckIsSUFBSSxDQUFDLElBQUksR0FBVSxFQUFFLENBQUM7UUFDdEIsSUFBSSxDQUFDLElBQUksR0FBVSxFQUFFLENBQUM7UUFFdEIsSUFBSSxDQUFDLGtCQUFrQixHQUFHLEtBQUssQ0FBQztRQUNoQyxJQUFJLENBQUMsZUFBZSxHQUFNLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFDO1FBRXJELElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUM7UUFDNUMsaUJBQWlCLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztJQUMxQyxDQUFDO0lBRU8sTUFBTSxDQUFDLGlCQUFp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LE1BQU0sSUFBSSxDQUFDLGtCQUFrQixFQUFFLENBQUM7UUFDaEMsTUFBTSxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQztRQUNuQyxNQUFNLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO1FBQzlCLE1BQU0sSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDO1FBQzdCLE1BQU0sSUFBSSxDQUFDLHNCQUFzQixFQUFFLENBQUM7SUFDeEMsQ0FBQztJQUVNLGFBQWE7UUFDaEIsTUFBTSxNQUFNLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUVuQywwQkFBZ0IsQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLEVBQUU7WUFDbEMsSUFBSSxVQUFVLElBQUksSUFBSSxDQUFDLElBQUk7Z0JBQ3ZCLDJEQUEyRDtnQkFDM0QsTUFBTSxDQUFDLFVBQVUsQ0FBQyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDbkQsQ0FBQyxDQUFDLENBQUM7UUFFSCxPQUFPLE1BQTBCLENBQUM7SUFDdEMsQ0FBQztDQUNKO0FBdmFELG9DQXVhQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGhhcywgc2V0IH0gZnJvbSAnbG9kYXNoJztcblxuaW1wb3J0IHByb2dyYW0sIHtcbiAgICBDb21tYW5kLFxuICAgIE9wdGlvbixcbn0gZnJvbSAnY29tbWFuZGVyJztcblxuaW1wb3J0IGRlZGVudCBmcm9tICdkZWRlbnQnO1xuaW1wb3J0IHsgR2VuZXJhbEVycm9yIH0gZnJvbSAnLi4vLi4vZXJyb3JzL3J1bnRpbWUnO1xuaW1wb3J0IHsgUlVOVElNRV9FUlJPUlMgfSBmcm9tICcuLi8uLi9lcnJvcnMvdHlwZXMnO1xuaW1wb3J0IHsgYXNzZXJ0VHlwZSwgaXMgfSBmcm9tICcuLi8uLi9lcnJvcnMvcnVudGltZS90eXBlLWFzc2VydGlvbnMnO1xuaW1wb3J0IGdldFZpZXdQb3J0V2lkdGggZnJvbSAnLi4vLi4vdXRpbHMvZ2V0LXZpZXdwb3J0LXdpZHRoJztcbmltcG9ydCB7IHdvcmRXcmFwLCBzcGxpdFF1b3RlZFRleHQgfSBmcm9tICcuLi8uLi91dGlscy9zdHJpbmcnO1xuaW1wb3J0IHtcbiAgICBnZXRTU0xPcHRpb25zLFxuICAgIGdldFF1YXJhbnRpbmVPcHRpb25zLFxuICAgIGdldFNjcmVlbnNob3RPcHRpb25zLFxuICAgIGdldFNraXBKc0Vycm9yc09wdGlvbnMsXG4gICAgZ2V0VmlkZW9PcHRpb25zLFxuICAgIGdldE1ldGFPcHRpb25zLFxuICAgIGdldEdyZXBPcHRpb25zLFxuICAgIGdldENvbXBpbGVyT3B0aW9ucyxcbiAgICBnZXREYXNoYm9hcmRPcHRpb25zLFxufSBmcm9tICcuLi8uLi91dGlscy9nZXQtb3B0aW9ucyc7XG5cbmltcG9ydCBnZXRGaWx0ZXJGbiBmcm9tICcuLi8uLi91dGlscy9nZXQtZmlsdGVyLWZuJztcbmltcG9ydCBTQ1JFRU5TSE9UX09QVElPTl9OQU1FUyBmcm9tICcuLi8uLi9jb25maWd1cmF0aW9uL3NjcmVlbnNob3Qtb3B0aW9uLW5hbWVzJztcbmltcG9ydCBSVU5fT1BUSU9OX05BTUVTIGZyb20gJy4uLy4uL2NvbmZpZ3VyYXRpb24vcnVuLW9wdGlvbi1uYW1lcyc7XG5pbXBvcnQge1xuICAgIERpY3Rpb25hcnksXG4gICAgUmVwb3J0ZXJPcHRpb24sXG4gICAgUnVubmVyUnVuT3B0aW9ucyxcbn0gZnJvbSAnLi4vLi4vY29uZmlndXJhdGlvbi9pbnRlcmZhY2VzJztcbmltcG9ydCBRVUFSQU5USU5FX09QVElPTl9OQU1FUyBmcm9tICcuLi8uLi9jb25maWd1cmF0aW9uL3F1YXJhbnRpbmUtb3B0aW9uLW5hbWVzJztcbmltcG9ydCB7IGV4dHJhY3ROb2RlUHJvY2Vzc0FyZ3VtZW50cyB9IGZyb20gJy4uL25vZGUtYXJndW1lbnRzLWZpbHRlcic7XG5pbXBvcnQgZ2V0VGVzdGNhZmVWZXJzaW9uIGZyb20gJy4uLy4uL3V0aWxzL2dldC10ZXN0Y2FmZS12ZXJzaW9uJztcbmltcG9ydCB7IHBhcnNlUG9ydE51bWJlciwgcGFyc2VMaXN0IH0gZnJvbSAnLi9wYXJzZS11dGlscyc7XG5pbXBvcnQgQ09NTUFORF9OQU1FUyBmcm9tICcuL2NvbW1hbmQtbmFtZXMnO1xuaW1wb3J0IHsgU2VuZFJlcG9ydFN0YXRlIH0gZnJvbSAnLi4vLi4vZGFzaGJvYXJkL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgU0tJUF9KU19FUlJPUlNfT1BUSU9OU19PQkpFQ1RfT1BUSU9OX05BTUVTIH0gZnJvbSAnLi4vLi4vY29uZmlndXJhdGlvbi9za2lwLWpzLWVycm9ycy1vcHRpb24tbmFtZXMnO1xuXG5jb25zdCBSRU1PVEVfQUxJQVNfUkUgPSAvXnJlbW90ZSg/OjooXFxkKikpPyQvO1xuXG5jb25zdCBERVNDUklQVElPTiA9IGRlZGVudChgXG4gICAgSW4gdGhlIGJyb3dzZXIgbGlzdCwgeW91IGNhbiB1c2UgYnJvd3NlciBuYW1lcyAoZS5nLiBcImllXCIsIFwiY2hyb21lXCIsIGV0Yy4pIGFzIHdlbGwgYXMgcGF0aHMgdG8gZXhlY3V0YWJsZXMuXG5cbiAgICBUbyBydW4gdGVzdHMgYWdhaW5zdCBhbGwgaW5zdGFsbGVkIGJyb3dzZXJzLCB1c2UgdGhlIFwiYWxsXCIgYWxpYXMuXG5cbiAgICBUbyB1c2UgYSByZW1vdGUgYnJvd3NlciBjb25uZWN0aW9uIChlLmcuLCB0byBjb25uZWN0IGEgbW9iaWxlIGRldmljZSksIHNwZWNpZnkgXCJyZW1vdGVcIiBhcyB0aGUgYnJvd3NlciBhbGlhcy5cbiAgICBJZiB5b3UgbmVlZCB0byBjb25uZWN0IG11bHRpcGxlIGRldmljZXMsIGFkZCBhIGNvbG9uIGFuZCB0aGUgbnVtYmVyIG9mIGJyb3dzZXJzIHlvdSB3YW50IHRvIGNvbm5lY3QgKGUuZy4sIFwicmVtb3RlOjNcIikuXG5cbiAgICBUbyBydW4gdGVzdHMgaW4gYSBicm93c2VyIGFjY2Vzc2VkIHRocm91Z2ggYSBicm93c2VyIHByb3ZpZGVyIHBsdWdpbiwgc3BlY2lmeSBhIGJyb3dzZXIgYWxpYXMgdGhhdCBjb25zaXN0cyBvZiB0d28gcGFydHMgLSB0aGUgYnJvd3NlciBwcm92aWRlciBuYW1lIHByZWZpeCBhbmQgdGhlIG5hbWUgb2YgdGhlIGJyb3dzZXIgaXRzZWxmOyBmb3IgZXhhbXBsZSwgXCJzYXVjZWxhYnM6Y2hyb21lQDUxXCIuXG5cbiAgICBZb3UgY2FuIHVzZSBvbmUgb3IgbW9yZSBmaWxlIHBhdGhzIG9yIGdsb2IgcGF0dGVybnMgdG8gc3BlY2lmeSB3aGljaCB0ZXN0cyB0byBydW4uXG5cbiAgICBNb3JlIGluZm86IGh0dHBzOi8vZGV2ZXhwcmVzcy5naXRodWIuaW8vdGVzdGNhZmUvZG9jdW1lbnRhdGlvblxuYCk7XG5cbmludGVyZmFjZSBDb21tYW5kTGluZU9wdGlvbnMge1xuICAgIHRlc3RHcmVwPzogc3RyaW5nIHwgUmVnRXhwO1xuICAgIGZpeHR1cmVHcmVwPzogc3RyaW5nIHwgUmVnRXhwO1xuICAgIHNyYz86IHN0cmluZ1tdO1xuICAgIGJyb3dzZXJzPzogc3RyaW5nW107XG4gICAgbGlzdEJyb3dzZXJzPzogYm9vbGVhbiB8IHN0cmluZztcbiAgICB0ZXN0TWV0YT86IHN0cmluZyB8IERpY3Rpb25hcnk8c3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbj47XG4gICAgZml4dHVyZU1ldGE/OiBzdHJpbmcgfCBEaWN0aW9uYXJ5PHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4+O1xuICAgIGZpbHRlcj86IEZ1bmN0aW9uO1xuICAgIGFwcEluaXREZWxheT86IHN0cmluZyB8IG51bWJlcjtcbiAgICBhc3NlcnRpb25UaW1lb3V0Pzogc3RyaW5nIHwgbnVtYmVyO1xuICAgIHNlbGVjdG9yVGltZW91dD86IHN0cmluZyB8IG51bWJlcjtcbiAgICBzcGVlZD86IHN0cmluZyB8IG51bWJlcjtcbiAgICBwYWdlTG9hZFRpbWVvdXQ/OiBzdHJpbmcgfCBudW1iZXI7XG4gICAgcGFnZVJlcXVlc3RUaW1lb3V0Pzogc3RyaW5nIHwgbnVtYmVyO1xuICAgIGFqYXhSZXF1ZXN0VGltZW91dD86IHN0cmluZyB8IG51bWJlcjtcbiAgICBicm93c2VySW5pdFRpbWVvdXQ/OiBzdHJpbmcgfCBudW1iZXI7XG4gICAgdGVzdEV4ZWN1dGlvblRpbWVvdXQ/OiBzdHJpbmcgfCBudW1iZXI7XG4gICAgcnVuRXhlY3V0aW9uVGltZW91dD86IHN0cmluZyB8IG51bWJlcjtcbiAgICBjb25jdXJyZW5jeT86IHN0cmluZyB8IG51bWJlcjtcbiAgICBxdWFyYW50aW5lTW9kZT86IGJvb2xlYW4gfCBEaWN0aW9uYXJ5PHN0cmluZyB8IG51bWJlcj47XG4gICAgcG9ydHM/OiBzdHJpbmcgfCBudW1iZXJbXTtcbiAgICBwcm92aWRlck5hbWU/OiBzdHJpbmc7XG4gICAgc3NsPzogc3RyaW5nIHwgRGljdGlvbmFyeTxzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuPjtcbiAgICByZXBvcnRlcj86IHN0cmluZyB8IFJlcG9ydGVyT3B0aW9uW107XG4gICAgc2NyZWVuc2hvdHM/OiBEaWN0aW9uYXJ5PHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4+IHwgc3RyaW5nO1xuICAgIHNjcmVlbnNob3RQYXRoUGF0dGVybj86IHN0cmluZztcbiAgICBzY3JlZW5zaG90c09uRmFpbHM/OiBib29sZWFuO1xuICAgIHZpZGVvT3B0aW9ucz86IHN0cmluZyB8IERpY3Rpb25hcnk8bnVtYmVyIHwgc3RyaW5nIHwgYm9vbGVhbj47XG4gICAgdmlkZW9FbmNvZGluZ09wdGlvbnM/OiBzdHJpbmcgfCBEaWN0aW9uYXJ5PG51bWJlciB8IHN0cmluZyB8IGJvb2xlYW4+O1xuICAgIGNvbXBpbGVyT3B0aW9ucz86IHN0cmluZyB8IERpY3Rpb25hcnk8bnVtYmVyIHwgc3RyaW5nIHwgYm9vbGVhbj47XG4gICAgY29uZmlnRmlsZT86IHN0cmluZztcbiAgICBwcm94eWxlc3M/OiBib29sZWFuO1xuICAgIHY4RmxhZ3M/OiBzdHJpbmdbXTtcbiAgICBkYXNoYm9hcmRPcHRpb25zPzogc3RyaW5nIHwgRGljdGlvbmFyeTxzdHJpbmcgfCBib29sZWFuIHwgbnVtYmVyPjtcbiAgICBiYXNlVXJsPzogc3RyaW5nO1xuICAgIHNraXBKc0Vycm9ycz86IGJvb2xlYW4gfCBEaWN0aW9uYXJ5PFJlZ0V4cCB8IHN0cmluZz47XG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIENMSUFyZ3VtZW50UGFyc2VyIHtcbiAgICBwcml2YXRlIGN3ZDogc3RyaW5nO1xuICAgIHByaXZhdGUgcmVtb3RlQ291bnQ6IG51bWJlcjtcbiAgICBwdWJsaWMgaXNEYXNoYm9hcmRDb21tYW5kOiBib29sZWFuO1xuICAgIHB1YmxpYyBzZW5kUmVwb3J0U3RhdGU6IFNlbmRSZXBvcnRTdGF0ZTtcbiAgICBwdWJsaWMgb3B0czogQ29tbWFuZExpbmVPcHRpb25zO1xuICAgIHB1YmxpYyBhcmdzOiBzdHJpbmdbXTtcbiAgICBwcml2YXRlIHJlYWRvbmx5IHRlc3RDYWZlQ29tbWFuZDogQ29tbWFuZDtcblxuICAgIHB1YmxpYyBjb25zdHJ1Y3RvciAoY3dkPzogc3RyaW5nKSB7XG4gICAgICAgIHRoaXMuY3dkICAgICAgICAgPSBjd2QgfHwgcHJvY2Vzcy5jd2QoKTtcbiAgICAgICAgdGhpcy5yZW1vdGVDb3VudCA9IDA7XG4gICAgICAgIHRoaXMub3B0cyAgICAgICAgPSB7fTtcbiAgICAgICAgdGhpcy5hcmdzICAgICAgICA9IFtdO1xuXG4gICAgICAgIHRoaXMuaXNEYXNoYm9hcmRDb21tYW5kID0gZmFsc2U7XG4gICAgICAgIHRoaXMudGVzdENhZmVDb21tYW5kICAgID0gdGhpcy5fYWRkVGVzdENhZmVDb21tYW5kKCk7XG5cbiAgICAgICAgdGhpcy5fcGF0Y2hIZWxwT3V0cHV0KHRoaXMudGVzdENhZmVDb21tYW5kKTtcbiAgICAgICAgQ0xJQXJndW1lbnRQYXJzZXIuX3NldHVwUm9vdENvbW1hbmQoKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHN0YXRpYyBfc2V0dXBSb290Q29tbWFuZCAoKTogdm9pZCB7XG4gICAgICAgIC8vIE5PVEU6IFdlIGFyZSBmb3JjZWQgdG8gc2V0IHRoZSBuYW1lIG9mIHRoZSByb290IGNvbW1hbmQgdG8gJ3Rlc3RjYWZlJ1xuICAgICAgICAvLyB0byBhdm9pZCB0aGUgYXV0b21hdGljIGNvbW1hbmQgbmFtZSBjYWxjdWxhdGlvbiB1c2luZyB0aGUgZXhlY3V0ZWQgZmlsZSBwYXRoLlxuICAgICAgICAvLyBJdCdzIG5lY2Vzc2FyeSB0byBjb3JyZWN0IGNvbW1hbmQgZGVzY3JpcHRpb24gZm9yIG5lc3RlZCBjb21tYW5kcy5cbiAgICAgICAgKHByb2dyYW0gYXMgdW5rbm93biBhcyBDb21tYW5kKS5uYW1lKENPTU1BTkRfTkFNRVMuVGVzdENhZmUpO1xuICAgIH1cblxuICAgIHByaXZhdGUgc3RhdGljIF9yZW1vdmVDb21tYW5kSWZFeGlzdHMgKG5hbWU6IHN0cmluZyk6IHZvaWQge1xuICAgICAgICAvLyBOT1RFOiBCdWcgaW4gdGhlICdjb21tYW5kZXInIG1vZHVsZS5cbiAgICAgICAgLy8gSXQncyBwb3NzaWJsZSB0byBhZGQgYSBmZXcgY29tbWFuZHMgd2l0aCB0aGUgc2FtZSBuYW1lLlxuICAgICAgICAvLyBBbHNvLCByZW1vdmluZyBpcyBhIGJldHRlciB0aGFuIGNvbmRpdGlvbmFsbHkgYWRkaW5nXG4gICAgICAgIC8vIGJlY2F1c2UgaXQgYWxsb3dzIGF2b2lkaW5nIHRoZSBwYXJzZWQgb3B0aW9uIGR1cGxpY2F0ZXMuXG4gICAgICAgIGNvbnN0IGluZGV4ID0gKHByb2dyYW0gYXMgdW5rbm93biBhcyBDb21tYW5kKS5jb21tYW5kcy5maW5kSW5kZXgoY21kID0+IGNtZC5uYW1lKCkgPT09IG5hbWUpO1xuXG4gICAgICAgIGlmIChpbmRleCA+IC0xKVxuICAgICAgICAgICAgKHByb2dyYW0gYXMgdW5rbm93biBhcyBDb21tYW5kKS5jb21tYW5kcy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgIH1cblxuICAgIHByaXZhdGUgc3RhdGljIF9nZXREZXNjcmlwdGlvbiAoKTogc3RyaW5nIHtcbiAgICAgICAgLy8gTk9URTogYWRkIGVtcHR5IGxpbmUgdG8gd29ya2Fyb3VuZCBjb21tYW5kZXItZm9yY2VkIGluZGVudGF0aW9uIG9uIHRoZSBmaXJzdCBsaW5lLlxuICAgICAgICByZXR1cm4gJ1xcbicgKyB3b3JkV3JhcChERVNDUklQVElPTiwgMiwgZ2V0Vmlld1BvcnRXaWR0aChwcm9jZXNzLnN0ZG91dCkpO1xuICAgIH1cblxuICAgIHByaXZhdGUgX2FkZFRlc3RDYWZlQ29tbWFuZCAoKTogQ29tbWFuZCB7XG4gICAgICAgIENMSUFyZ3VtZW50UGFyc2VyLl9yZW1vdmVDb21tYW5kSWZFeGlzdHMoQ09NTUFORF9OQU1FUy5UZXN0Q2FmZSk7XG5cbiAgICAgICAgcmV0dXJuIChwcm9ncmFtIGFzIHVua25vd24gYXMgQ29tbWFuZClcbiAgICAgICAgICAgIC5jb21tYW5kKENPTU1BTkRfTkFNRVMuVGVzdENhZmUsIHsgaXNEZWZhdWx0OiB0cnVlIH0pXG4gICAgICAgICAgICAudmVyc2lvbihnZXRUZXN0Y2FmZVZlcnNpb24oKSwgJy12LCAtLXZlcnNpb24nKVxuICAgICAgICAgICAgLnVzYWdlKCdbb3B0aW9uc10gPGNvbW1hLXNlcGFyYXRlZC1icm93c2VyLWxpc3Q+IDxmaWxlLW9yLWdsb2IgLi4uPicpXG4gICAgICAgICAgICAuZGVzY3JpcHRpb24oQ0xJQXJndW1lbnRQYXJzZXIuX2dldERlc2NyaXB0aW9uKCkpXG5cbiAgICAgICAgICAgIC5hbGxvd1Vua25vd25PcHRpb24oKVxuICAgICAgICAgICAgLm9wdGlvbignLWIsIC0tbGlzdC1icm93c2VycyBbcHJvdmlkZXJdJywgJ291dHB1dCB0aGUgYWxpYXNlcyBmb3IgbG9jYWwgYnJvd3NlcnMgb3IgYnJvd3NlcnMgYXZhaWxhYmxlIHRocm91Z2ggdGhlIHNwZWNpZmllZCBicm93c2VyIHByb3ZpZGVyJylcbiAgICAgICAgICAgIC5vcHRpb24oJy1yLCAtLXJlcG9ydGVyIDxuYW1lWzpvdXRwdXRGaWxlXVssLi4uXT4nLCAnc3BlY2lmeSB0aGUgcmVwb3J0ZXJzIGFuZCBvcHRpb25hbGx5IGZpbGVzIHdoZXJlIHJlcG9ydHMgYXJlIHNhdmVkJylcbiAgICAgICAgICAgIC5vcHRpb24oJy1zLCAtLXNjcmVlbnNob3RzIDxvcHRpb249dmFsdWVbLC4uLl0+JywgJ3NwZWNpZnkgc2NyZWVuc2hvdCBvcHRpb25zJylcbiAgICAgICAgICAgIC5vcHRpb24oJy1TLCAtLXNjcmVlbnNob3RzLW9uLWZhaWxzJywgJ3Rha2UgYSBzY3JlZW5zaG90IHdoZW5ldmVyIGEgdGVzdCBmYWlscycpXG4gICAgICAgICAgICAub3B0aW9uKCctcCwgLS1zY3JlZW5zaG90LXBhdGgtcGF0dGVybiA8cGF0dGVybj4nLCAndXNlIHBhdHRlcm5zIHRvIGNvbXBvc2Ugc2NyZWVuc2hvdCBmaWxlIG5hbWVzIGFuZCBwYXRoczogJHtCUk9XU0VSfSwgJHtCUk9XU0VSX1ZFUlNJT059LCAke09TfSwgZXRjLicpXG4gICAgICAgICAgICAub3B0aW9uKCctcSwgLS1xdWFyYW50aW5lLW1vZGUgW29wdGlvbj12YWx1ZSwuLi5dJywgJ2VuYWJsZSBxdWFyYW50aW5lIG1vZGUgYW5kIChvcHRpb25hbGx5KSBtb2RpZnkgcXVhcmFudGluZSBtb2RlIHNldHRpbmdzJylcbiAgICAgICAgICAgIC5vcHRpb24oJy1kLCAtLWRlYnVnLW1vZGUnLCAnZXhlY3V0ZSB0ZXN0IHN0ZXBzIG9uZSBieSBvbmUgcGF1c2luZyB0aGUgdGVzdCBhZnRlciBlYWNoIHN0ZXAnKVxuICAgICAgICAgICAgLm9wdGlvbignLWUsIC0tc2tpcC1qcy1lcnJvcnMgW29wdGlvbj12YWx1ZSwuLi5dJywgJ2lnbm9yZSBKYXZhU2NyaXB0IGVycm9ycyB0aGF0IG1hdGNoIHRoZSBzcGVjaWZpZWQgY3JpdGVyaWEnKVxuICAgICAgICAgICAgLm9wdGlvbignLXUsIC0tc2tpcC11bmNhdWdodC1lcnJvcnMnLCAnaWdub3JlIHVuY2F1Z2h0IGVycm9ycyBhbmQgdW5oYW5kbGVkIHByb21pc2UgcmVqZWN0aW9ucywgd2hpY2ggb2NjdXIgZHVyaW5nIHRlc3QgZXhlY3V0aW9uJylcbiAgICAgICAgICAgIC5vcHRpb24oJy10LCAtLXRlc3QgPG5hbWU+JywgJ3J1biBvbmx5IHRlc3RzIHdpdGggdGhlIHNwZWNpZmllZCBuYW1lJylcbiAgICAgICAgICAgIC5vcHRpb24oJy1ULCAtLXRlc3QtZ3JlcCA8cGF0dGVybj4nLCAncnVuIG9ubHkgdGVzdHMgbWF0Y2hpbmcgdGhlIHNwZWNpZmllZCBwYXR0ZXJuJylcbiAgICAgICAgICAgIC5vcHRpb24oJy1mLCAtLWZpeHR1cmUgPG5hbWU+JywgJ3J1biBvbmx5IGZpeHR1cmVzIHdpdGggdGhlIHNwZWNpZmllZCBuYW1lJylcbiAgICAgICAgICAgIC5vcHRpb24oJy1GLCAtLWZpeHR1cmUtZ3JlcCA8cGF0dGVybj4nLCAncnVuIG9ubHkgZml4dHVyZXMgbWF0Y2hpbmcgdGhlIHNwZWNpZmllZCBwYXR0ZXJuJylcbiAgICAgICAgICAgIC5vcHRpb24oJy1hLCAtLWFwcCA8Y29tbWFuZD4nLCAnbGF1bmNoIHRoZSB0ZXN0ZWQgYXBwIHVzaW5nIHRoZSBzcGVjaWZpZWQgY29tbWFuZCBiZWZvcmUgcnVubmluZyB0ZXN0cycpXG4gICAgICAgICAgICAub3B0aW9uKCctYywgLS1jb25jdXJyZW5jeSA8bnVtYmVyPicsICdydW4gdGVzdHMgY29uY3VycmVudGx5JylcbiAgICAgICAgICAgIC5vcHRpb24oJy1MLCAtLWxpdmUnLCAnZW5hYmxlIGxpdmUgbW9kZS4gSW4gdGhpcyBtb2RlLCBUZXN0Q2FmZSB3YXRjaGVzIGZvciBjaGFuZ2VzIHlvdSBtYWtlIGluIHRoZSB0ZXN0IGZpbGVzLiBUaGVzZSBjaGFuZ2VzIGltbWVkaWF0ZWx5IHJlc3RhcnQgdGhlIHRlc3RzIHNvIHRoYXQgeW91IGNhbiBzZWUgdGhlIGVmZmVjdC4nKVxuICAgICAgICAgICAgLm9wdGlvbignLS10ZXN0LW1ldGEgPGtleT12YWx1ZVssa2V5Mj12YWx1ZTIsLi4uXT4nLCAncnVuIG9ubHkgdGVzdHMgd2l0aCBtYXRjaGluZyBtZXRhZGF0YScpXG4gICAgICAgICAgICAub3B0aW9uKCctLWZpeHR1cmUtbWV0YSA8a2V5PXZhbHVlWyxrZXkyPXZhbHVlMiwuLi5dPicsICdydW4gb25seSBmaXh0dXJlcyB3aXRoIG1hdGNoaW5nIG1ldGFkYXRhJylcbiAgICAgICAgICAgIC5vcHRpb24oJy0tZGVidWctb24tZmFpbCcsICdwYXVzZSB0aGUgdGVzdCBpZiBpdCBmYWlscycpXG4gICAgICAgICAgICAub3B0aW9uKCctLWFwcC1pbml0LWRlbGF5IDxtcz4nLCAnc3BlY2lmeSBob3cgbXVjaCB0aW1lIGl0IHRha2VzIGZvciB0aGUgdGVzdGVkIGFwcCB0byBpbml0aWFsaXplJylcbiAgICAgICAgICAgIC5vcHRpb24oJy0tc2VsZWN0b3ItdGltZW91dCA8bXM+JywgJ3NwZWNpZnkgdGhlIHRpbWUgd2l0aGluIHdoaWNoIHNlbGVjdG9ycyBtYWtlIGF0dGVtcHRzIHRvIG9idGFpbiBhIG5vZGUgdG8gYmUgcmV0dXJuZWQnKVxuICAgICAgICAgICAgLm9wdGlvbignLS1hc3NlcnRpb24tdGltZW91dCA8bXM+JywgJ3NwZWNpZnkgdGhlIHRpbWUgd2l0aGluIHdoaWNoIGFzc2VydGlvbiBzaG91bGQgcGFzcycpXG4gICAgICAgICAgICAub3B0aW9uKCctLXBhZ2UtbG9hZC10aW1lb3V0IDxtcz4nLCAnc3BlY2lmeSB0aGUgdGltZSB3aXRoaW4gd2hpY2ggVGVzdENhZmUgd2FpdHMgZm9yIHRoZSBgd2luZG93LmxvYWRgIGV2ZW50IHRvIGZpcmUgb24gcGFnZSBsb2FkIGJlZm9yZSBwcm9jZWVkaW5nIHRvIHRoZSBuZXh0IHRlc3QgYWN0aW9uJylcbiAgICAgICAgICAgIC5vcHRpb24oJy0tcGFnZS1yZXF1ZXN0LXRpbWVvdXQgPG1zPicsIFwic3BlY2lmaWVzIHRoZSB0aW1lb3V0IGluIG1pbGxpc2Vjb25kcyB0byBjb21wbGV0ZSB0aGUgcmVxdWVzdCBmb3IgdGhlIHBhZ2UncyBIVE1MXCIpXG4gICAgICAgICAgICAub3B0aW9uKCctLWFqYXgtcmVxdWVzdC10aW1lb3V0IDxtcz4nLCAnc3BlY2lmaWVzIHRoZSB0aW1lb3V0IGluIG1pbGxpc2Vjb25kcyB0byBjb21wbGV0ZSB0aGUgQUpBWCByZXF1ZXN0cyAoWEhSIG9yIGZldGNoKScpXG4gICAgICAgICAgICAub3B0aW9uKCctLWJyb3dzZXItaW5pdC10aW1lb3V0IDxtcz4nLCAnc3BlY2lmeSB0aGUgdGltZSAoaW4gbWlsbGlzZWNvbmRzKSBUZXN0Q2FmZSB3YWl0cyBmb3IgdGhlIGJyb3dzZXIgdG8gc3RhcnQnKVxuICAgICAgICAgICAgLm9wdGlvbignLS10ZXN0LWV4ZWN1dGlvbi10aW1lb3V0IDxtcz4nLCAnc3BlY2lmeSB0aGUgdGltZSAoaW4gbWlsbGlzZWNvbmRzKSBUZXN0Q2FmZSB3YWl0cyBmb3IgdGhlIHRlc3QgZXhlY3V0ZWQnKVxuICAgICAgICAgICAgLm9wdGlvbignLS1ydW4tZXhlY3V0aW9uLXRpbWVvdXQgPG1zPicsICdzcGVjaWZ5IHRoZSB0aW1lIChpbiBtaWxsaXNlY29uZHMpIFRlc3RDYWZlIHdhaXRzIGZvciB0aGUgYWxsIHRlc3QgZXhlY3V0ZWQnKVxuICAgICAgICAgICAgLm9wdGlvbignLS1zcGVlZCA8ZmFjdG9yPicsICdzZXQgdGhlIHNwZWVkIG9mIHRlc3QgZXhlY3V0aW9uICgwLjAxIC4uLiAxKScpXG4gICAgICAgICAgICAub3B0aW9uKCctLXBvcnRzIDxwb3J0MSxwb3J0Mj4nLCAnc3BlY2lmeSBjdXN0b20gcG9ydCBudW1iZXJzJylcbiAgICAgICAgICAgIC5vcHRpb24oJy0taG9zdG5hbWUgPG5hbWU+JywgJ3NwZWNpZnkgdGhlIGhvc3RuYW1lJylcbiAgICAgICAgICAgIC5vcHRpb24oJy0tcHJveHkgPGhvc3Q+JywgJ3NwZWNpZnkgdGhlIGhvc3Qgb2YgdGhlIHByb3h5IHNlcnZlcicpXG4gICAgICAgICAgICAub3B0aW9uKCctLXByb3h5LWJ5cGFzcyA8cnVsZXM+JywgJ3NwZWNpZnkgYSBjb21tYS1zZXBhcmF0ZWQgbGlzdCBvZiBydWxlcyB0aGF0IGRlZmluZSBVUkxzIGFjY2Vzc2VkIGJ5cGFzc2luZyB0aGUgcHJveHkgc2VydmVyJylcbiAgICAgICAgICAgIC5vcHRpb24oJy0tc3NsIDxvcHRpb25zPicsICdzcGVjaWZ5IFNTTCBvcHRpb25zIHRvIHJ1biBUZXN0Q2FmZSBwcm94eSBzZXJ2ZXIgb3ZlciB0aGUgSFRUUFMgcHJvdG9jb2wnKVxuICAgICAgICAgICAgLm9wdGlvbignLS12aWRlbyA8cGF0aD4nLCAncmVjb3JkIHZpZGVvcyBvZiB0ZXN0IHJ1bnMnKVxuICAgICAgICAgICAgLm9wdGlvbignLS12aWRlby1vcHRpb25zIDxvcHRpb249dmFsdWVbLC4uLl0+JywgJ3NwZWNpZnkgdmlkZW8gcmVjb3JkaW5nIG9wdGlvbnMnKVxuICAgICAgICAgICAgLm9wdGlvbignLS12aWRlby1lbmNvZGluZy1vcHRpb25zIDxvcHRpb249dmFsdWVbLC4uLl0+JywgJ3NwZWNpZnkgZW5jb2Rpbmcgb3B0aW9ucycpXG4gICAgICAgICAgICAub3B0aW9uKCctLWRldicsICdlbmFibGVzIG1lY2hhbmlzbXMgdG8gbG9nIGFuZCBkaWFnbm9zZSBlcnJvcnMnKVxuICAgICAgICAgICAgLm9wdGlvbignLS1xci1jb2RlJywgJ291dHB1dHMgUVItY29kZSB0aGF0IHJlcGVhdHMgVVJMcyB1c2VkIHRvIGNvbm5lY3QgdGhlIHJlbW90ZSBicm93c2VycycpXG4gICAgICAgICAgICAub3B0aW9uKCctLXNmLCAtLXN0b3Atb24tZmlyc3QtZmFpbCcsICdzdG9wIGFuIGVudGlyZSB0ZXN0IHJ1biBpZiBhbnkgdGVzdCBmYWlscycpXG4gICAgICAgICAgICAub3B0aW9uKCctLWNvbmZpZy1maWxlIDxwYXRoPicsICdzcGVjaWZ5IGEgY3VzdG9tIHBhdGggdG8gdGhlIHRlc3RjYWZlIGNvbmZpZ3VyYXRpb24gZmlsZScpXG4gICAgICAgICAgICAub3B0aW9uKCctLXRzLWNvbmZpZy1wYXRoIDxwYXRoPicsICd1c2UgYSBjdXN0b20gVHlwZVNjcmlwdCBjb25maWd1cmF0aW9uIGZpbGUgYW5kIHNwZWNpZnkgaXRzIGxvY2F0aW9uJylcbiAgICAgICAgICAgIC5vcHRpb24oJy0tY3MsIC0tY2xpZW50LXNjcmlwdHMgPHBhdGhzPicsICdpbmplY3Qgc2NyaXB0cyBpbnRvIHRlc3RlZCBwYWdlcycsIHBhcnNlTGlzdCwgW10pXG4gICAgICAgICAgICAub3B0aW9uKCctLWRpc2FibGUtcGFnZS1jYWNoaW5nJywgJ2Rpc2FibGUgcGFnZSBjYWNoaW5nIGR1cmluZyB0ZXN0IGV4ZWN1dGlvbicpXG4gICAgICAgICAgICAub3B0aW9uKCctLWRpc2FibGUtcGFnZS1yZWxvYWRzJywgJ2Rpc2FibGUgcGFnZSByZWxvYWRzIGJldHdlZW4gdGVzdHMnKVxuICAgICAgICAgICAgLm9wdGlvbignLS1yZXRyeS10ZXN0LXBhZ2VzJywgJ3JldHJ5IG5ldHdvcmsgcmVxdWVzdHMgdG8gdGVzdCBwYWdlcyBkdXJpbmcgdGVzdCBleGVjdXRpb24nKVxuICAgICAgICAgICAgLm9wdGlvbignLS1kaXNhYmxlLXNjcmVlbnNob3RzJywgJ2Rpc2FibGUgc2NyZWVuc2hvdHMnKVxuICAgICAgICAgICAgLm9wdGlvbignLS1zY3JlZW5zaG90cy1mdWxsLXBhZ2UnLCAnZW5hYmxlIGZ1bGwtcGFnZSBzY3JlZW5zaG90cycpXG4gICAgICAgICAgICAub3B0aW9uKCctLWNvbXBpbGVyLW9wdGlvbnMgPG9wdGlvbj12YWx1ZVssLi4uXT4nLCAnc3BlY2lmeSB0ZXN0IGZpbGUgY29tcGlsZXIgb3B0aW9ucycpXG4gICAgICAgICAgICAub3B0aW9uKCctLWRpc2FibGUtbXVsdGlwbGUtd2luZG93cycsICdkaXNhYmxlIG11bHRpcGxlIHdpbmRvd3MgbW9kZScpXG4gICAgICAgICAgICAub3B0aW9uKCctLWRpc2FibGUtaHR0cDInLCAnZGlzYWJsZSB0aGUgSFRUUC8yIHByb3h5IGJhY2tlbmQgYW5kIGZvcmNlIHRoZSBwcm94eSB0byB1c2Ugb25seSBIVFRQLzEuMSByZXF1ZXN0cycpXG4gICAgICAgICAgICAub3B0aW9uKCctLWNhY2hlJywgJ2NhY2hlIHdlYiBhc3NldHMgYmV0d2VlbiB0ZXN0IHJ1bnMnKVxuICAgICAgICAgICAgLm9wdGlvbignLS1iYXNlLXVybCA8dXJsPicsICdzZXQgdGhlIGJhc2UgdXJsIGZvciBhbGwgdGVzdHMnKVxuXG4gICAgICAgICAgICAvLyBOT1RFOiB0aGVzZSBvcHRpb25zIHdpbGwgYmUgaGFuZGxlZCBieSBjaGFsayBpbnRlcm5hbGx5XG4gICAgICAgICAgICAub3B0aW9uKCctLWNvbG9yJywgJ2ZvcmNlIGNvbG9ycyBpbiBjb21tYW5kIGxpbmUnKVxuICAgICAgICAgICAgLm9wdGlvbignLS1uby1jb2xvcicsICdkaXNhYmxlIGNvbG9ycyBpbiBjb21tYW5kIGxpbmUnKVxuXG4gICAgICAgICAgICAvLyBOT1RFOiB0ZW1wb3JhcnkgaGlkZSBleHBlcmltZW50YWwgb3B0aW9ucyBmcm9tIC0taGVscCBjb21tYW5kXG4gICAgICAgICAgICAuYWRkT3B0aW9uKG5ldyBPcHRpb24oJy0tcHJveHlsZXNzJywgJ2V4cGVyaW1lbnRhbCcpLmhpZGVIZWxwKCkpXG4gICAgICAgICAgICAuYWRkT3B0aW9uKG5ldyBPcHRpb24oJy0tZXhwZXJpbWVudGFsLWRlYnVnJywgJ2VuYWJsZSBleHBlcmltZW50YWwgZGVidWcgbW9kZScpLmhpZGVIZWxwKCkpXG4gICAgICAgICAgICAuYWN0aW9uKChvcHRzOiBDb21tYW5kTGluZU9wdGlvbnMpID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLm9wdHMgPSBvcHRzO1xuICAgICAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfcGF0Y2hIZWxwT3V0cHV0IChkZWZhdWx0U3ViQ29tbWFuZDogQ29tbWFuZCk6IHZvaWQge1xuICAgICAgICAvLyBOT1RFOiBJbiB0aGUgZnV0dXJlIHZlcnNpb25zIG9mIHRoZSAnY29tbWFuZGVyJyBtb2R1bGVcbiAgICAgICAgLy8gbmVlZCB0byBpbnZlc3RpZ2F0ZSBob3cgdG8gcmVtb3ZlIHRoaXMgaGFjay5cbiAgICAgICAgKHByb2dyYW0gYXMgdW5rbm93biBhcyBDb21tYW5kKS5vdXRwdXRIZWxwID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgY29uc3Qgc3RvcmVkUGFyZW50ID0gZGVmYXVsdFN1YkNvbW1hbmQucGFyZW50O1xuXG4gICAgICAgICAgICBkZWZhdWx0U3ViQ29tbWFuZC5wYXJlbnQgPSBudWxsO1xuXG4gICAgICAgICAgICBkZWZhdWx0U3ViQ29tbWFuZC5vdXRwdXRIZWxwKCk7XG5cbiAgICAgICAgICAgIGRlZmF1bHRTdWJDb21tYW5kLnBhcmVudCA9IHN0b3JlZFBhcmVudDtcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBwcml2YXRlIF9jaGVja0FuZENvdW50UmVtb3RlcyAoYnJvd3Nlcjogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgICAgIGNvbnN0IHJlbW90ZU1hdGNoID0gYnJvd3Nlci5tYXRjaChSRU1PVEVfQUxJQVNfUkUpO1xuXG4gICAgICAgIGlmIChyZW1vdGVNYXRjaCkge1xuICAgICAgICAgICAgdGhpcy5yZW1vdGVDb3VudCArPSBwYXJzZUludChyZW1vdGVNYXRjaFsxXSwgMTApIHx8IDE7XG5cbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIHB1YmxpYyBhc3luYyBfcGFyc2VGaWx0ZXJpbmdPcHRpb25zICgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgaWYgKHRoaXMub3B0cy50ZXN0R3JlcClcbiAgICAgICAgICAgIHRoaXMub3B0cy50ZXN0R3JlcCA9IGdldEdyZXBPcHRpb25zKCctLXRlc3QtZ3JlcCcsIHRoaXMub3B0cy50ZXN0R3JlcCBhcyBzdHJpbmcpO1xuXG4gICAgICAgIGlmICh0aGlzLm9wdHMuZml4dHVyZUdyZXApXG4gICAgICAgICAgICB0aGlzLm9wdHMuZml4dHVyZUdyZXAgPSBnZXRHcmVwT3B0aW9ucygnLS1maXh0dXJlLWdyZXAnLCB0aGlzLm9wdHMuZml4dHVyZUdyZXAgYXMgc3RyaW5nKTtcblxuICAgICAgICBpZiAodGhpcy5vcHRzLnRlc3RNZXRhKVxuICAgICAgICAgICAgdGhpcy5vcHRzLnRlc3RNZXRhID0gYXdhaXQgZ2V0TWV0YU9wdGlvbnMoJy0tdGVzdC1tZXRhJywgdGhpcy5vcHRzLnRlc3RNZXRhIGFzIHN0cmluZyk7XG5cbiAgICAgICAgaWYgKHRoaXMub3B0cy5maXh0dXJlTWV0YSlcbiAgICAgICAgICAgIHRoaXMub3B0cy5maXh0dXJlTWV0YSA9IGF3YWl0IGdldE1ldGFPcHRpb25zKCctLWZpeHR1cmUtbWV0YScsIHRoaXMub3B0cy5maXh0dXJlTWV0YSBhcyBzdHJpbmcpO1xuXG4gICAgICAgIHRoaXMub3B0cy5maWx0ZXIgPSBnZXRGaWx0ZXJGbih0aGlzLm9wdHMpO1xuICAgIH1cblxuICAgIHByaXZhdGUgX3BhcnNlQXBwSW5pdERlbGF5ICgpOiB2b2lkIHtcbiAgICAgICAgaWYgKHRoaXMub3B0cy5hcHBJbml0RGVsYXkpIHtcbiAgICAgICAgICAgIGFzc2VydFR5cGUoaXMubm9uTmVnYXRpdmVOdW1iZXJTdHJpbmcsIG51bGwsICdUaGUgdGVzdGVkIGFwcCBpbml0aWFsaXphdGlvbiBkZWxheScsIHRoaXMub3B0cy5hcHBJbml0RGVsYXkpO1xuXG4gICAgICAgICAgICB0aGlzLm9wdHMuYXBwSW5pdERlbGF5ID0gcGFyc2VJbnQodGhpcy5vcHRzLmFwcEluaXREZWxheSBhcyBzdHJpbmcsIDEwKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgX3BhcnNlU2VsZWN0b3JUaW1lb3V0ICgpOiB2b2lkIHtcbiAgICAgICAgaWYgKHRoaXMub3B0cy5zZWxlY3RvclRpbWVvdXQpIHtcbiAgICAgICAgICAgIGFzc2VydFR5cGUoaXMubm9uTmVnYXRpdmVOdW1iZXJTdHJpbmcsIG51bGwsICdUaGUgU2VsZWN0b3IgdGltZW91dCcsIHRoaXMub3B0cy5zZWxlY3RvclRpbWVvdXQpO1xuXG4gICAgICAgICAgICB0aGlzLm9wdHMuc2VsZWN0b3JUaW1lb3V0ID0gcGFyc2VJbnQodGhpcy5vcHRzLnNlbGVjdG9yVGltZW91dCBhcyBzdHJpbmcsIDEwKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgX3BhcnNlQXNzZXJ0aW9uVGltZW91dCAoKTogdm9pZCB7XG4gICAgICAgIGlmICh0aGlzLm9wdHMuYXNzZXJ0aW9uVGltZW91dCkge1xuICAgICAgICAgICAgYXNzZXJ0VHlwZShpcy5ub25OZWdhdGl2ZU51bWJlclN0cmluZywgbnVsbCwgJ1RoZSBhc3NlcnRpb24gdGltZW91dCcsIHRoaXMub3B0cy5hc3NlcnRpb25UaW1lb3V0KTtcblxuICAgICAgICAgICAgdGhpcy5vcHRzLmFzc2VydGlvblRpbWVvdXQgPSBwYXJzZUludCh0aGlzLm9wdHMuYXNzZXJ0aW9uVGltZW91dCBhcyBzdHJpbmcsIDEwKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgX3BhcnNlUGFnZUxvYWRUaW1lb3V0ICgpOiB2b2lkIHtcbiAgICAgICAgaWYgKHRoaXMub3B0cy5wYWdlTG9hZFRpbWVvdXQpIHtcbiAgICAgICAgICAgIGFzc2VydFR5cGUoaXMubm9uTmVnYXRpdmVOdW1iZXJTdHJpbmcsIG51bGwsICdUaGUgcGFnZSBsb2FkIHRpbWVvdXQnLCB0aGlzLm9wdHMucGFnZUxvYWRUaW1lb3V0KTtcblxuICAgICAgICAgICAgdGhpcy5vcHRzLnBhZ2VMb2FkVGltZW91dCA9IHBhcnNlSW50KHRoaXMub3B0cy5wYWdlTG9hZFRpbWVvdXQgYXMgc3RyaW5nLCAxMCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIF9wYXJzZVBhZ2VSZXF1ZXN0VGltZW91dCAoKTogdm9pZCB7XG4gICAgICAgIGlmICghdGhpcy5vcHRzLnBhZ2VSZXF1ZXN0VGltZW91dClcbiAgICAgICAgICAgIHJldHVybjtcblxuICAgICAgICBhc3NlcnRUeXBlKGlzLm5vbk5lZ2F0aXZlTnVtYmVyU3RyaW5nLCBudWxsLCAnVGhlIHBhZ2UgcmVxdWVzdCB0aW1lb3V0JywgdGhpcy5vcHRzLnBhZ2VSZXF1ZXN0VGltZW91dCk7XG5cbiAgICAgICAgdGhpcy5vcHRzLnBhZ2VSZXF1ZXN0VGltZW91dCA9IHBhcnNlSW50KHRoaXMub3B0cy5wYWdlUmVxdWVzdFRpbWVvdXQgYXMgc3RyaW5nLCAxMCk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfcGFyc2VBamF4UmVxdWVzdFRpbWVvdXQgKCk6IHZvaWQge1xuICAgICAgICBpZiAoIXRoaXMub3B0cy5hamF4UmVxdWVzdFRpbWVvdXQpXG4gICAgICAgICAgICByZXR1cm47XG5cbiAgICAgICAgYXNzZXJ0VHlwZShpcy5ub25OZWdhdGl2ZU51bWJlclN0cmluZywgbnVsbCwgJ1RoZSBBSkFYIHJlcXVlc3QgdGltZW91dCcsIHRoaXMub3B0cy5hamF4UmVxdWVzdFRpbWVvdXQpO1xuXG4gICAgICAgIHRoaXMub3B0cy5hamF4UmVxdWVzdFRpbWVvdXQgPSBwYXJzZUludCh0aGlzLm9wdHMuYWpheFJlcXVlc3RUaW1lb3V0IGFzIHN0cmluZywgMTApO1xuICAgIH1cblxuICAgIHByaXZhdGUgX3BhcnNlQnJvd3NlckluaXRUaW1lb3V0ICgpOiB2b2lkIHtcbiAgICAgICAgaWYgKCF0aGlzLm9wdHMuYnJvd3NlckluaXRUaW1lb3V0KVxuICAgICAgICAgICAgcmV0dXJuO1xuXG4gICAgICAgIGFzc2VydFR5cGUoaXMubm9uTmVnYXRpdmVOdW1iZXJTdHJpbmcsIG51bGwsICdUaGUgYnJvd3NlciBpbml0aWFsaXphdGlvbiB0aW1lb3V0JywgdGhpcy5vcHRzLmJyb3dzZXJJbml0VGltZW91dCk7XG5cbiAgICAgICAgdGhpcy5vcHRzLmJyb3dzZXJJbml0VGltZW91dCA9IHBhcnNlSW50KHRoaXMub3B0cy5icm93c2VySW5pdFRpbWVvdXQgYXMgc3RyaW5nLCAxMCk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfcGFyc2VUZXN0RXhlY3V0aW9uVGltZW91dCAoKTogdm9pZCB7XG4gICAgICAgIGlmICh0aGlzLm9wdHMudGVzdEV4ZWN1dGlvblRpbWVvdXQpIHtcbiAgICAgICAgICAgIGFzc2VydFR5cGUoaXMubm9uTmVnYXRpdmVOdW1iZXJTdHJpbmcsIG51bGwsICdUaGUgdGVzdCBleGVjdXRpb24gdGltZW91dCcsIHRoaXMub3B0cy50ZXN0RXhlY3V0aW9uVGltZW91dCk7XG5cbiAgICAgICAgICAgIHRoaXMub3B0cy50ZXN0RXhlY3V0aW9uVGltZW91dCA9IHBhcnNlSW50KHRoaXMub3B0cy50ZXN0RXhlY3V0aW9uVGltZW91dCBhcyBzdHJpbmcsIDEwKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgX3BhcnNlUnVuRXhlY3V0aW9uVGltZW91dCAoKTogdm9pZCB7XG4gICAgICAgIGlmICh0aGlzLm9wdHMucnVuRXhlY3V0aW9uVGltZW91dCkge1xuICAgICAgICAgICAgYXNzZXJ0VHlwZShpcy5ub25OZWdhdGl2ZU51bWJlclN0cmluZywgbnVsbCwgJ1RoZSBydW4gZXhlY3V0aW9uIHRpbWVvdXQnLCB0aGlzLm9wdHMucnVuRXhlY3V0aW9uVGltZW91dCk7XG5cbiAgICAgICAgICAgIHRoaXMub3B0cy5ydW5FeGVjdXRpb25UaW1lb3V0ID0gcGFyc2VJbnQodGhpcy5vcHRzLnJ1bkV4ZWN1dGlvblRpbWVvdXQgYXMgc3RyaW5nLCAxMCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIF9wYXJzZVNwZWVkICgpOiB2b2lkIHtcbiAgICAgICAgaWYgKHRoaXMub3B0cy5zcGVlZClcbiAgICAgICAgICAgIHRoaXMub3B0cy5zcGVlZCA9IHBhcnNlRmxvYXQodGhpcy5vcHRzLnNwZWVkIGFzIHN0cmluZyk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfcGFyc2VDb25jdXJyZW5jeSAoKTogdm9pZCB7XG4gICAgICAgIGlmICh0aGlzLm9wdHMuY29uY3VycmVuY3kpXG4gICAgICAgICAgICB0aGlzLm9wdHMuY29uY3VycmVuY3kgPSBwYXJzZUludCh0aGlzLm9wdHMuY29uY3VycmVuY3kgYXMgc3RyaW5nLCAxMCk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBfcGFyc2VRdWFyYW50aW5lT3B0aW9ucyAoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGlmICh0aGlzLm9wdHMucXVhcmFudGluZU1vZGUpXG4gICAgICAgICAgICB0aGlzLm9wdHMucXVhcmFudGluZU1vZGUgPSBhd2FpdCBnZXRRdWFyYW50aW5lT3B0aW9ucygnLS1xdWFyYW50aW5lLW1vZGUnLCB0aGlzLm9wdHMucXVhcmFudGluZU1vZGUpO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgX3BhcnNlU2tpcEpzRXJyb3JzT3B0aW9ucyAoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGlmICh0aGlzLm9wdHMuc2tpcEpzRXJyb3JzKVxuICAgICAgICAgICAgdGhpcy5vcHRzLnNraXBKc0Vycm9ycyA9IGF3YWl0IGdldFNraXBKc0Vycm9yc09wdGlvbnMoJy0tc2tpcC1qcy1lcnJvcnMnLCB0aGlzLm9wdHMuc2tpcEpzRXJyb3JzKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIF9wYXJzZVBvcnRzICgpOiB2b2lkIHtcbiAgICAgICAgaWYgKHRoaXMub3B0cy5wb3J0cykge1xuICAgICAgICAgICAgY29uc3QgcGFyc2VkUG9ydHMgPSAodGhpcy5vcHRzLnBvcnRzIGFzIHN0cmluZykgLyogZXNsaW50LWRpc2FibGUtbGluZSBuby1leHRyYS1wYXJlbnMgKi9cbiAgICAgICAgICAgICAgICAuc3BsaXQoJywnKVxuICAgICAgICAgICAgICAgIC5tYXAocGFyc2VQb3J0TnVtYmVyKTtcblxuICAgICAgICAgICAgaWYgKHBhcnNlZFBvcnRzLmxlbmd0aCA8IDIpXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEdlbmVyYWxFcnJvcihSVU5USU1FX0VSUk9SUy5wb3J0c09wdGlvblJlcXVpcmVzVHdvTnVtYmVycyk7XG5cbiAgICAgICAgICAgIHRoaXMub3B0cy5wb3J0cyA9IHBhcnNlZFBvcnRzIGFzIG51bWJlcltdO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfcGFyc2VCcm93c2Vyc0Zyb21BcmdzICgpOiB2b2lkIHtcbiAgICAgICAgY29uc3QgYnJvd3NlcnNBcmcgPSB0aGlzLnRlc3RDYWZlQ29tbWFuZC5hcmdzWzBdIHx8ICcnO1xuXG4gICAgICAgIHRoaXMub3B0cy5icm93c2VycyA9IHNwbGl0UXVvdGVkVGV4dChicm93c2Vyc0FyZywgJywnKVxuICAgICAgICAgICAgLmZpbHRlcihicm93c2VyID0+IGJyb3dzZXIgJiYgdGhpcy5fY2hlY2tBbmRDb3VudFJlbW90ZXMoYnJvd3NlcikpO1xuICAgIH1cblxuICAgIHB1YmxpYyBhc3luYyBfcGFyc2VTc2xPcHRpb25zICgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgaWYgKHRoaXMub3B0cy5zc2wpXG4gICAgICAgICAgICB0aGlzLm9wdHMuc3NsID0gYXdhaXQgZ2V0U1NMT3B0aW9ucyh0aGlzLm9wdHMuc3NsIGFzIHN0cmluZyk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBfcGFyc2VSZXBvcnRlcnMgKCk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBjb25zdCByZXBvcnRlcnMgPSB0aGlzLm9wdHMucmVwb3J0ZXIgPyAodGhpcy5vcHRzLnJlcG9ydGVyIGFzIHN0cmluZykuc3BsaXQoJywnKSA6IFtdOyAvKiBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLWV4dHJhLXBhcmVucyovXG5cbiAgICAgICAgdGhpcy5vcHRzLnJlcG9ydGVyID0gcmVwb3J0ZXJzLm1hcCgocmVwb3J0ZXI6IHN0cmluZykgPT4ge1xuICAgICAgICAgICAgY29uc3Qgc2VwYXJhdG9ySW5kZXggPSByZXBvcnRlci5pbmRleE9mKCc6Jyk7XG5cbiAgICAgICAgICAgIGlmIChzZXBhcmF0b3JJbmRleCA8IDApXG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgbmFtZTogcmVwb3J0ZXIgfTtcblxuICAgICAgICAgICAgY29uc3QgbmFtZSAgID0gcmVwb3J0ZXIuc3Vic3RyaW5nKDAsIHNlcGFyYXRvckluZGV4KTtcbiAgICAgICAgICAgIGNvbnN0IG91dHB1dCA9IHJlcG9ydGVyLnN1YnN0cmluZyhzZXBhcmF0b3JJbmRleCArIDEpO1xuXG4gICAgICAgICAgICByZXR1cm4geyBuYW1lLCBvdXRwdXQgfTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfcGFyc2VGaWxlTGlzdCAoKTogdm9pZCB7XG4gICAgICAgIHRoaXMub3B0cy5zcmMgPSB0aGlzLnRlc3RDYWZlQ29tbWFuZC5hcmdzLnNsaWNlKDEpO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgX3BhcnNlU2NyZWVuc2hvdE9wdGlvbnMgKCk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBpZiAodGhpcy5vcHRzLnNjcmVlbnNob3RzKVxuICAgICAgICAgICAgdGhpcy5vcHRzLnNjcmVlbnNob3RzID0gYXdhaXQgZ2V0U2NyZWVuc2hvdE9wdGlvbnModGhpcy5vcHRzLnNjcmVlbnNob3RzKTtcbiAgICAgICAgZWxzZVxuICAgICAgICAgICAgdGhpcy5vcHRzLnNjcmVlbnNob3RzID0ge307XG5cbiAgICAgICAgaWYgKCFoYXModGhpcy5vcHRzLnNjcmVlbnNob3RzLCBTQ1JFRU5TSE9UX09QVElPTl9OQU1FUy5wYXRoUGF0dGVybikgJiYgdGhpcy5vcHRzLnNjcmVlbnNob3RQYXRoUGF0dGVybilcbiAgICAgICAgICAgIHRoaXMub3B0cy5zY3JlZW5zaG90c1tTQ1JFRU5TSE9UX09QVElPTl9OQU1FUy5wYXRoUGF0dGVybl0gPSB0aGlzLm9wdHMuc2NyZWVuc2hvdFBhdGhQYXR0ZXJuO1xuXG4gICAgICAgIGlmICghaGFzKHRoaXMub3B0cy5zY3JlZW5zaG90cywgU0NSRUVOU0hPVF9PUFRJT05fTkFNRVMudGFrZU9uRmFpbHMpICYmIHRoaXMub3B0cy5zY3JlZW5zaG90c09uRmFpbHMpXG4gICAgICAgICAgICB0aGlzLm9wdHMuc2NyZWVuc2hvdHNbU0NSRUVOU0hPVF9PUFRJT05fTkFNRVMudGFrZU9uRmFpbHNdID0gdGhpcy5vcHRzLnNjcmVlbnNob3RzT25GYWlscztcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIF9wYXJzZVZpZGVvT3B0aW9ucyAoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGlmICh0aGlzLm9wdHMudmlkZW9PcHRpb25zKVxuICAgICAgICAgICAgdGhpcy5vcHRzLnZpZGVvT3B0aW9ucyA9IGF3YWl0IGdldFZpZGVvT3B0aW9ucyh0aGlzLm9wdHMudmlkZW9PcHRpb25zIGFzIHN0cmluZyk7XG5cbiAgICAgICAgaWYgKHRoaXMub3B0cy52aWRlb0VuY29kaW5nT3B0aW9ucylcbiAgICAgICAgICAgIHRoaXMub3B0cy52aWRlb0VuY29kaW5nT3B0aW9ucyA9IGF3YWl0IGdldFZpZGVvT3B0aW9ucyh0aGlzLm9wdHMudmlkZW9FbmNvZGluZ09wdGlvbnMgYXMgc3RyaW5nKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIF9wYXJzZUNvbXBpbGVyT3B0aW9ucyAoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGlmICghdGhpcy5vcHRzLmNvbXBpbGVyT3B0aW9ucylcbiAgICAgICAgICAgIHJldHVybjtcblxuICAgICAgICBjb25zdCBwYXJzZWRDb21waWxlck9wdGlvbnMgPSBhd2FpdCBnZXRDb21waWxlck9wdGlvbnModGhpcy5vcHRzLmNvbXBpbGVyT3B0aW9ucyBhcyBzdHJpbmcpO1xuICAgICAgICBjb25zdCByZXN1bHRDb21waWxlck9wdGlvbnMgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuXG4gICAgICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHBhcnNlZENvbXBpbGVyT3B0aW9ucykpXG4gICAgICAgICAgICBzZXQocmVzdWx0Q29tcGlsZXJPcHRpb25zLCBrZXksIHZhbHVlKTtcblxuICAgICAgICB0aGlzLm9wdHMuY29tcGlsZXJPcHRpb25zID0gcmVzdWx0Q29tcGlsZXJPcHRpb25zO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgX3BhcnNlRGFzaGJvYXJkT3B0aW9ucyAoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGlmICh0aGlzLm9wdHMuZGFzaGJvYXJkT3B0aW9ucylcbiAgICAgICAgICAgIHRoaXMub3B0cy5kYXNoYm9hcmRPcHRpb25zID0gYXdhaXQgZ2V0RGFzaGJvYXJkT3B0aW9ucyh0aGlzLm9wdHMuZGFzaGJvYXJkT3B0aW9ucyBhcyBzdHJpbmcpO1xuICAgIH1cblxuICAgIHByaXZhdGUgX3BhcnNlTGlzdEJyb3dzZXJzICgpOiB2b2lkIHtcbiAgICAgICAgY29uc3QgbGlzdEJyb3dzZXJPcHRpb24gPSB0aGlzLm9wdHMubGlzdEJyb3dzZXJzO1xuXG4gICAgICAgIHRoaXMub3B0cy5saXN0QnJvd3NlcnMgPSAhIXRoaXMub3B0cy5saXN0QnJvd3NlcnM7XG5cbiAgICAgICAgaWYgKCF0aGlzLm9wdHMubGlzdEJyb3dzZXJzKVxuICAgICAgICAgICAgcmV0dXJuO1xuXG4gICAgICAgIHRoaXMub3B0cy5wcm92aWRlck5hbWUgPSB0eXBlb2YgbGlzdEJyb3dzZXJPcHRpb24gPT09ICdzdHJpbmcnID8gbGlzdEJyb3dzZXJPcHRpb24gOiAnbG9jYWxseS1pbnN0YWxsZWQnO1xuICAgIH1cblxuICAgIHByaXZhdGUgc3RhdGljIF9wcmVwYXJlQm9vbGVhbk9yT2JqZWN0T3B0aW9uIChhcmd2OiBzdHJpbmdbXSwgb3B0aW9uTmFtZXM6IHN0cmluZ1tdLCBzdWJPcHRpb25zTmFtZXM6IHN0cmluZ1tdKTogdm9pZCB7XG4gICAgICAgIC8vIE5PVEU6IG1vdmUgb3B0aW9ucyB0byB0aGUgZW5kIG9mIHRoZSBhcnJheSB0byBjb3JyZWN0bHkgcGFyc2UgYm90aCBCb29sZWFuIGFuZCBPYmplY3QgdHlwZSBhcmd1bWVudHMgKEdILTYyMzEpXG4gICAgICAgIGNvbnN0IG9wdGlvbkluZGV4ID0gYXJndi5maW5kSW5kZXgoXG4gICAgICAgICAgICBlbCA9PiBvcHRpb25OYW1lcy5zb21lKG9wdCA9PiBlbC5zdGFydHNXaXRoKG9wdCkpKTtcblxuICAgICAgICBpZiAob3B0aW9uSW5kZXggPiAtMSkge1xuICAgICAgICAgICAgY29uc3QgaXNOb3RMYXN0T3B0aW9uICAgICAgID0gb3B0aW9uSW5kZXggPCBhcmd2Lmxlbmd0aCAtIDE7XG4gICAgICAgICAgICBjb25zdCBzaG91bGRNb3ZlT3B0aW9uVG9FbmQgPSBpc05vdExhc3RPcHRpb24gJiZcbiAgICAgICAgICAgICAgICAhc3ViT3B0aW9uc05hbWVzLnNvbWUob3B0ID0+IGFyZ3Zbb3B0aW9uSW5kZXggKyAxXS5zdGFydHNXaXRoKG9wdCkpO1xuXG4gICAgICAgICAgICBpZiAoc2hvdWxkTW92ZU9wdGlvblRvRW5kKVxuICAgICAgICAgICAgICAgIGFyZ3YucHVzaChhcmd2LnNwbGljZShvcHRpb25JbmRleCwgMSlbMF0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHVibGljIGFzeW5jIHBhcnNlIChhcmd2OiBzdHJpbmdbXSk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBDTElBcmd1bWVudFBhcnNlci5fcHJlcGFyZUJvb2xlYW5Pck9iamVjdE9wdGlvbihhcmd2LCBbJy1xJywgJy0tcXVhcmFudGluZS1tb2RlJ10sIE9iamVjdC52YWx1ZXMoUVVBUkFOVElORV9PUFRJT05fTkFNRVMpKTtcbiAgICAgICAgQ0xJQXJndW1lbnRQYXJzZXIuX3ByZXBhcmVCb29sZWFuT3JPYmplY3RPcHRpb24oYXJndiwgWyctZScsICctLXNraXAtanMtZXJyb3JzJ10sIE9iamVjdC52YWx1ZXMoU0tJUF9KU19FUlJPUlNfT1BUSU9OU19PQkpFQ1RfT1BUSU9OX05BTUVTKSk7XG5cbiAgICAgICAgY29uc3QgeyBhcmdzLCB2OEZsYWdzIH0gPSBleHRyYWN0Tm9kZVByb2Nlc3NBcmd1bWVudHMoYXJndik7XG5cbiAgICAgICAgKHByb2dyYW0gYXMgdW5rbm93biBhcyBDb21tYW5kKS5wYXJzZShhcmdzKTtcblxuICAgICAgICB0aGlzLmFyZ3MgPSAocHJvZ3JhbSBhcyB1bmtub3duIGFzIENvbW1hbmQpLmFyZ3M7XG4gICAgICAgIHRoaXMub3B0cyA9IE9iamVjdC5hc3NpZ24odGhpcy5vcHRzLCB7IHY4RmxhZ3MgfSk7XG5cbiAgICAgICAgdGhpcy5fcGFyc2VMaXN0QnJvd3NlcnMoKTtcblxuICAgICAgICAvLyBOT1RFOiB0aGUgJy0tbGlzdC1icm93c2Vycycgb3B0aW9uIG9ubHkgbGlzdHMgYnJvd3NlcnMgYW5kIGltbWVkaWF0ZWx5IGV4aXRzIHRoZSBhcHAuXG4gICAgICAgIC8vIFRoZXJlZm9yZSwgd2UgZG9uJ3QgbmVlZCB0byBwcm9jZXNzIG90aGVyIGFyZ3VtZW50cy5cbiAgICAgICAgaWYgKHRoaXMub3B0cy5saXN0QnJvd3NlcnMpXG4gICAgICAgICAgICByZXR1cm47XG5cbiAgICAgICAgdGhpcy5fcGFyc2VTZWxlY3RvclRpbWVvdXQoKTtcbiAgICAgICAgdGhpcy5fcGFyc2VBc3NlcnRpb25UaW1lb3V0KCk7XG4gICAgICAgIHRoaXMuX3BhcnNlUGFnZUxvYWRUaW1lb3V0KCk7XG4gICAgICAgIHRoaXMuX3BhcnNlUGFnZVJlcXVlc3RUaW1lb3V0KCk7XG4gICAgICAgIHRoaXMuX3BhcnNlQWpheFJlcXVlc3RUaW1lb3V0KCk7XG4gICAgICAgIHRoaXMuX3BhcnNlQnJvd3NlckluaXRUaW1lb3V0KCk7XG4gICAgICAgIHRoaXMuX3BhcnNlVGVzdEV4ZWN1dGlvblRpbWVvdXQoKTtcbiAgICAgICAgdGhpcy5fcGFyc2VSdW5FeGVjdXRpb25UaW1lb3V0KCk7XG4gICAgICAgIHRoaXMuX3BhcnNlQXBwSW5pdERlbGF5KCk7XG4gICAgICAgIHRoaXMuX3BhcnNlU3BlZWQoKTtcbiAgICAgICAgdGhpcy5fcGFyc2VQb3J0cygpO1xuICAgICAgICB0aGlzLl9wYXJzZUJyb3dzZXJzRnJvbUFyZ3MoKTtcbiAgICAgICAgdGhpcy5fcGFyc2VDb25jdXJyZW5jeSgpO1xuICAgICAgICB0aGlzLl9wYXJzZUZpbGVMaXN0KCk7XG5cbiAgICAgICAgYXdhaXQgdGhpcy5fcGFyc2VGaWx0ZXJpbmdPcHRpb25zKCk7XG4gICAgICAgIGF3YWl0IHRoaXMuX3BhcnNlUXVhcmFudGluZU9wdGlvbnMoKTtcbiAgICAgICAgYXdhaXQgdGhpcy5fcGFyc2VTa2lwSnNFcnJvcnNPcHRpb25zKCk7XG4gICAgICAgIGF3YWl0IHRoaXMuX3BhcnNlU2NyZWVuc2hvdE9wdGlvbnMoKTtcbiAgICAgICAgYXdhaXQgdGhpcy5fcGFyc2VWaWRlb09wdGlvbnMoKTtcbiAgICAgICAgYXdhaXQgdGhpcy5fcGFyc2VDb21waWxlck9wdGlvbnMoKTtcbiAgICAgICAgYXdhaXQgdGhpcy5fcGFyc2VTc2xPcHRpb25zKCk7XG4gICAgICAgIGF3YWl0IHRoaXMuX3BhcnNlUmVwb3J0ZXJzKCk7XG4gICAgICAgIGF3YWl0IHRoaXMuX3BhcnNlRGFzaGJvYXJkT3B0aW9ucygpO1xuICAgIH1cblxuICAgIHB1YmxpYyBnZXRSdW5PcHRpb25zICgpOiBSdW5uZXJSdW5PcHRpb25zIHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcblxuICAgICAgICBSVU5fT1BUSU9OX05BTUVTLmZvckVhY2gob3B0aW9uTmFtZSA9PiB7XG4gICAgICAgICAgICBpZiAob3B0aW9uTmFtZSBpbiB0aGlzLm9wdHMpXG4gICAgICAgICAgICAgICAgLy8gQHRzLWlnbm9yZSBhIGhhY2sgdG8gYWRkIGFuIGluZGV4IHNpZ25hdHVyZSB0byBpbnRlcmZhY2VcbiAgICAgICAgICAgICAgICByZXN1bHRbb3B0aW9uTmFtZV0gPSB0aGlzLm9wdHNbb3B0aW9uTmFtZV07XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiByZXN1bHQgYXMgUnVubmVyUnVuT3B0aW9ucztcbiAgICB9XG59XG4iXX0=