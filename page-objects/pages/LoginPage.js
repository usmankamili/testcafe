import { Selector , t } from "testcafe";
import BasePage  from "./BasePage";

class LoginPage extends BasePage{
    constructor(){
        super()
        this.usernameInput = Selector('#username')
        this.passwordInput = Selector('#password')
        this.termsCheckbox = Selector('#terms')
        this.signInBtn = Selector('#signInBtn')
        this.checkOutButton = Selector('a.nav-link.btn-primary')
        this.ErrorMsg = Selector('.alert-error')

    }

    async loginToApp(username,password)
    {
        await t
        .typeText(this.usernameInput , username , {paste:true,replace:true})
        .typeText(this.passwordInput , password , {paste:true , replace:true})
        .click(this.termsCheckbox)
        .click(this.signInBtn)
    }
    
    async assertLoginPassed(){
        await t
        .expect(this.checkOutButton.exists).ok()
        .expect(this.termsCheckbox.exists).notOk()
    }
}

export default LoginPage