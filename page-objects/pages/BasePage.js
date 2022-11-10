import { Selector , t } from "testcafe";

class BasePage{
    async waitFor(millisecs){
        t.wait(millisecs)
    }

    async setTestSpeed(speed)
    {
        t.setTestSpeed(speed)
    }
}

export default BasePage