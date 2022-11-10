import {t} from 'testcafe'

export async function login(username , password)
{
    await t.typeText('#username' , 'rahulshettyacademy' , {paste:true})
    await t.typeText('#password' , 'learning' , {paste:true})
    await t.click('#terms')

    await t.click('#signInBtn')
}