import { Selector } from "testcafe";
import { login } from "../helper";

fixture('confirm login to rahul shetty')
.page('https://rahulshettyacademy.com/loginpagePractise/')


test.before(async t=>{
    await login('rahulshettyacademy' , 'learning')
})('Confirm user logged in' , async t=> {
    const checkOutButton = Selector('a.nav-link.btn-primary')
    const termsCheckbox = Selector('#terms')

    
    await t.expect(checkOutButton.exists).ok()
    await t.expect(termsCheckbox.exists).notOk()
})
