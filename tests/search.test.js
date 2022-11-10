import Navbar from '../page-objects/components/Navbar'
import SearchResultsPage from '../page-objects/pages/SearchResultsPage'
const navbar = new Navbar()
const searchResultsPage = new SearchResultsPage()

fixture('Search fixture')
    .page('http://zero.webappsecurity.com/index.html')
    
test('Search test' , async t => {

     navbar.search('hello')
    await t.expect(searchResultsPage.linkText.innerText).contains('Search Results:')

})    

