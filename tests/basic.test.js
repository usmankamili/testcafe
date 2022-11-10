import { Selector } from "testcafe";
import xPathToCss from 'xpath-to-css'

fixture `Getting started with testcafe`
    .page(`https://devexpress.github.io/testcafe/example/`)
    .before(async t=> {

    })
    .beforeEach(async t => {
    await t.setTestSpeed(1)
    })
    .afterEach(async t => {

    })
    .after(async t=> {

    })



test(`My first testcafe git test` , async t => {
    const developer_name = Selector('#developer-name') 
    const submitButton = Selector('#submit-button') 
    const articleText = Selector('#article-header') 
    const xpath = './/input[@id="developer-name"]'
    const cssDevloperName = xPathToCss(xpath);
    console.log(cssDevloperName)

    //await t.takeScreenshot({fullPage:true})
  //  await t.takeElementScreenshot(submitButton)
    await t.typeText(cssDevloperName , 'John')
    await t.click(submitButton)

    await t.expect(Selector(articleText).innerText).contains('John')
}).timeouts({
    pageLoadTimeout: 2000,
    pageRequestTimeout: 60000,
    ajaxRequestTimeout: 60000
})    
