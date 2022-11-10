import { Selector } from "testcafe";

fixture('Forget password')
.page('http://zero.webappsecurity.com/')

test('User clicks' , async t => {
    const signInButton = Selector('#signin_button')
    await t.click(signInButton)

    const loginForm = Selector('#login_form')

    await t.expect(loginForm.exists).ok();

    const forgetPwdLink = Selector('a').withText('Forgot your password ?')
    await t.click(forgetPwdLink);

    const emailInput = Selector('#user_email')
    await t.typeText(emailInput , 'dotcom@dot.com' , {paste:true})

    const sendPasswordBtn = Selector('input.btn-primary')

    await t.click(sendPasswordBtn)

    const successPwdDiv = Selector('div.offset3.span6')

    await t.expect(successPwdDiv.innerText).contains('Your password will be sent to the following email')
    await t.expect(emailInput.exists).notOk();

})