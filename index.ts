import { WebSocketServer } from 'ws';

import puppeteer from 'puppeteer-extra';

import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(AdblockerPlugin()).use(StealthPlugin());

const wss = new WebSocketServer({ port: 4001 });

const inputSelector =
  'form[action="https://www.ultimate-guitar.com/search.php"] input[placeholder="Enter artist name or song title"]';

interface Suggestion {
  suggest: string;
  ws?: any;
  results?: string[];
}

interface Search {
  search: string;
  page?: number;
  ws?: any;
  results?: any[];
}

const suggestions: Suggestion[] = [];
const searches: Search[] = [];

const clear = (page) => {
  return page.keyboard.down('Control').then((ign) => {
    page.keyboard.press('a').then((ign) => {
      page.keyboard.up('Control').then((ign) => {
        page.keyboard.press('Backspace').then((ign) => {
          //console.log('cleared');
        });
      });
    });
  });
};

const search = async (browser) => {
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(0);
  await page.goto('https://www.ultimate-guitar.com/');
  page.waitForNavigation({ waitUntil: 'load' });
  return page;
};

const typeahead = async (browser) => {
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(0);
  await page.goto('https://www.ultimate-guitar.com/');
  page.waitForNavigation({ waitUntil: 'load' });
  const suggestInput = await page.waitForSelector(inputSelector);

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
          const json = await response.json();
          const searchTerm = response
            .url()
            .split('/')
            .pop()
            .slice(0, -3)
            .replace(/_/gi, ' ');
          const suggestion = suggestions.find((s: Suggestion) => {
            return s.suggest === searchTerm;
          });

          if (suggestion) {
            suggestion.ws.send(
              JSON.stringify({
                suggest: suggestion.suggest,
                results: json.suggestions,
              })
            );
            suggestion.results = json.suggestions;
            delete suggestion.ws;
            clear(page);
          } else {
            suggestions.push({
              suggest: searchTerm,
              results: json.suggestions,
            });
          }
        } catch (e) {
          console.log('error:', e);
        }
      }
    }
  });
  return suggestInput;
};

puppeteer
  .launch({
    headless: true,
    defaultViewport: null,
    args: ['--no-sandbox', '--start-maximized'],
  })
  .then(async (browser) => {
    const [suggestInput, searchPage] = await Promise.all([
      typeahead(browser),
      search(browser),
    ]);
    console.log('ready!');
    wss.on('connection', function connection(ws) {
      ws.on('message', function message(data) {
        const json = JSON.parse(data);
        if (json.suggest && json.suggest.length > 0) {
          const suggest = suggestions.find((s: Suggestion) => {
            return s.suggest === json.suggest;
          });
          if (suggest) {
            console.log('suggest found:', json.suggest);
            ws.send(
              JSON.stringify({
                suggest: json.suggest,
                results: suggest.results,
              })
            );
          } else {
            console.log('suggest lookup:', json.suggest);
            suggestInput.focus();
            suggestions.push({ suggest: json.suggest, ws: ws });
            suggestInput.type(json.suggest);
          }
        } else if (json.search && json.search.length > 0) {
          const search = searches.find((s: Search) => {
            return s.search === json.search;
          });
          if (search) {
            console.log('search found:', json.search);
            ws.send(
              JSON.stringify({ search: json.search, results: search.results })
            );
          } else {
            console.log('search lookup:', json.search);
            searchPage
              .goto(
                `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURI(json.search)}`,
                { waitUntil: 'load' }
              )
              .then((res: any) => {
                console.log('status:', res.ok());
                searchPage
                  .evaluate(() => {
                    const divs = document.querySelectorAll(
                      'section > article > div > div > div:nth-child(4)'
                    );
                    const good = Array.from(divs)
                      .filter((d) => {
                        return (
                          [
                            'chords',
                            'tab',
                            'power',
                            'bass',
                            'guitar pro',
                          ].indexOf(d.textContent) > -1
                        );
                      })
                      .map((qualify) => {
                        return {
                          type: qualify.textContent,
                          song: qualify.parentNode.querySelector(
                            'div:nth-child(2) > header > span > span > a'
                          ).textContent,
                        };
                      });
                    return good;
                  })
                  .then((results) => {
                    if (results.length > 0) {
                      console.log('search result length:', results.length);
                      const res = {
                        search: json.search,
                        results: results,
                      };
                      searches.push(res);
                      ws.send(JSON.stringify(res));
                    } else {
                      console.log('empty search');
                      searches.push({ search: json.search, results: [] });
                      ws.send(
                        JSON.stringify({
                          search: json.search,
                          results: search.results,
                        })
                      );
                    }
                  });
              });
          }
        }
      });
    });
  });
