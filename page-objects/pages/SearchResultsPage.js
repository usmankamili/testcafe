import { Selector , t } from "testcafe";

class SearchResultsPage{
    constructor(){
        this.linkText = Selector('h2')
    }

}

export default SearchResultsPage
