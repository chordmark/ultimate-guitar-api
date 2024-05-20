import { WebSocketServer } from 'ws';

import puppeteer from 'puppeteer-extra';

import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(AdblockerPlugin()).use(StealthPlugin());

const wss = new WebSocketServer({ port: 4001 });

const inputSelector = 'form[action="https://www.ultimate-guitar.com/search.php"] input[placeholder="Enter artist name or song title"]';

interface Suggestion {
  search: string;
  ws?: any;
  suggestions?: string[]
}

const suggestions: Suggestion[] = []

const clear = (page) => {
  return page.keyboard.down('Control').then( (ign) => {
    page.keyboard.press('a').then( (ign) => {
      page.keyboard.up('Control').then( (ign) => {
        page.keyboard.press('Backspace').then( (ign) => {
          //console.log('cleared');
        })
      })
    })
  });
}

const typeahead = async (browser) => {
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(0);
  await page.goto('https://www.ultimate-guitar.com/');
  page.waitForNavigation({ waitUntil: 'load' });
  const searchInput = await page.waitForSelector(
    inputSelector
  );

  page.on('response', async (response) => {
    if (
      response
        .url()
        .startsWith(
          'https://www.ultimate-guitar.com/static/article/suggestions'
        )
    ) {
      if (response.ok) {
        try {
          const result = await response.json();
          const searchTerm = response.url().split('/').pop().slice(0, -3).replace(/_/gi, ' ');
          const suggestion = suggestions.find( (s: any) => {
            return s.search === searchTerm
          })

          if ( suggestion ) {
            suggestion.ws.send(JSON.stringify({search: suggestion.search, suggestions: result.suggestions}));
            suggestion.suggestions = result.suggestions;
            delete suggestion.ws;
            clear(page)
          } else {
            suggestions.push({ search: searchTerm, suggestions: result.suggestions});
          }
        } catch (e) {
          console.log('error:', e);
        }
      }
    }
  });
  return searchInput;
}

puppeteer
  .launch({
    headless: true,
    defaultViewport: null,
    args: ['--no-sandbox', '--start-maximized'],
  })
  .then(async (browser) => {
    const searchInput = await typeahead(browser);
    wss.on('connection', function connection(ws) {
      ws.on('message', function message(data) {
        const json = JSON.parse(data)
        if ( json.search && json.search.length > 0 ) {
          const find = suggestions.find( (s: any) => {
            return s.search === json.search
          })
          if ( find ) {
            console.log('found:', json.search)
            ws.send(JSON.stringify({ search: json.search, suggestions: find.suggestions}))
          } else {            
            console.log('lookup:', json.search)
            searchInput.focus();
            suggestions.push( { search: json.search, ws: ws} )
            searchInput.type(json.search); 
          }          
        } else if ( json.find && json.find.length > 0 ) {
          console.log('need to implement')
        }
      });
    });
  });
