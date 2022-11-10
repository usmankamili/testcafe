import { Selector } from "testcafe";
import Navbar from '../page-objects/components/Navbar'
import LoginPage from '../page-objects/pages/LoginPage'
const navbar = new Navbar()
const loginPage = new LoginPage()

fixture('Login Test')
    .page('http://zero.webappsecurity.com/')

test('User cannot login with invalid credentials' , async t => {
    await t.click(navbar.signInButton)

    const loginForm = Selector('#login_form')

    await t.expect(loginForm.exists).ok();

    const usernameInput = Selector('#user_login')
    const passwordInput = Selector('#user_password')

    await t.typeText(usernameInput , 'Invalid username' , {paste:true})
    await t.typeText(passwordInput , 'Invalid passwrord' , {paste:true})

    const signInBtn = Selector('.btn-primary')

    await t.click(signInBtn)

    

    await t.expect(loginPage.ErrorMsg.exists).ok();
    await t.expect(loginPage.ErrorMsg.innerText).contains('Login and/or password are wrong.');

})   


fixture('Login test to Rahul Shetty Acedamy')
    .page('https://rahulshettyacademy.com/loginpagePractise/')
    
test('User can login with valid credentials' , async t => {

    await loginPage.loginToApp('rahulshettyacademy' , 'learning')
    await loginPage.assertLoginPassed()
})    

