import { WebSocketServer } from 'ws';

import puppeteer from 'puppeteer-extra';

import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(AdblockerPlugin()).use(StealthPlugin());

const wss = new WebSocketServer({ port: 4001 });

const inputSelector =
  'form[action="https://www.ultimate-guitar.com/search.php"] input[placeholder="Enter artist name or song title"]';

interface Music {
  music: string;
  results?: string[];
}

interface Suggestion {
  suggest: string;
  ws?: any;
  results?: string[];
}

interface Search {
  search: string;
  page?: number;
  results?: any[];
}

const suggestResults: Suggestion[] = [];
const searchResults: Search[] = [];
const musicResults: Music[] = [];

const safeJson = async (response) => {
  try {
    const json = await response.json();
    return json;
  } catch (e) {
    return { suggestions: [] };
  }
};

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

const music = async (browser) => {
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
        const json = await safeJson(response);
        const searchTerm = response
          .url()
          .split('/')
          .pop()
          .slice(0, -3)
          .replace(/_/gi, ' ');

        const suggestion = suggestResults.find((s: Suggestion) => {
          return s.suggest === searchTerm;
        });

        if (suggestion) {
          console.log(
            'suggest complete:',
            `:${suggestion.suggest}:`,
            json.suggestions.length
          );
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
          console.log(
            'random suggest complete:',
            `:${suggestion.suggest}:`,
            json.suggestions.length
          );
          suggestResults.push({
            suggest: searchTerm,
            results: json.suggestions,
          });
        }
      }
    }
  });
  return suggestInput;
};

puppeteer
  .launch({
    headless: false,
    defaultViewport: null,
    args: ['--no-sandbox', '--start-maximized'],
  })
  .then(async (browser) => {
    const [suggestInput, searchPage, musicPage] = await Promise.all([
      typeahead(browser),
      search(browser),
      music(browser),
    ]);
    console.log('ready!');
    wss.on('connection', function connection(ws) {
      ws.on('message', function message(data) {
        const json = JSON.parse(data);
        if (json.music && json.music.length > 0) {
          const foundMusic = musicResults.find((m: Music) => {
            return m.music === json.music;
          });
          if (foundMusic) {
            console.log(
              'music found:',
              `:${json.music}:`,
              foundMusic.results.length
            );
            ws.send(
              JSON.stringify({
                music: json.search,
                results: foundMusic.results,
              })
            );
          } else {
            console.log('music lookup:', json.music);
            musicPage
              .goto(json.music, { waitUntil: 'load' })
              .then((res: any) => {
                console.log('music status:', res.ok());
                musicPage
                  .waitForSelector('article section section pre')
                  .then((ok) => {
                    musicPage
                      .evaluate(() => {
                        const pre = document.querySelector(
                          'article section section pre'
                        );
                        if (pre) {
                          return pre.textContent;
                        } else {
                          return 'Not Found';
                        }
                      })
                      .then((text) => {
                        console.log('retrieved music:', text.length);
                        if (text.length > 0) {
                          const res = {
                            music: json.music,
                            results: [text],
                          };
                          musicResults.push(res);
                          ws.send(JSON.stringify(res));
                        } else {
                          console.log('empty music');
                          musicResults.push({ music: json.music, results: [] });
                          ws.send(
                            JSON.stringify({
                              music: json.music,
                              results: [],
                            })
                          );
                        }
                      });
                  });
              });
          }
        } else if (json.suggest && json.suggest.length > 0) {
          const foundSuggest = suggestResults.find((s: Suggestion) => {
            return s.suggest === json.suggest;
          });
          if (foundSuggest) {
            console.log(
              'suggest found:',
              `:${json.suggest}:`,
              foundSuggest.results.length
            );
            ws.send(
              JSON.stringify({
                suggest: json.suggest,
                results: foundSuggest.results,
              })
            );
          } else {
            console.log('suggest lookup:', `:${json.suggest}:`);
            suggestInput.focus();
            suggestResults.push({ suggest: json.suggest, ws: ws });
            suggestInput.type(json.suggest);
          }
        } else if (json.search && json.search.length > 0) {
          const foundSearch = searchResults.find((s: Search) => {
            return s.search === json.search;
          });
          if (foundSearch) {
            console.log(
              'search found:',
              `:${json.suggest}:`,
              json.results.length
            );
            ws.send(
              JSON.stringify({
                search: json.search,
                results: foundSearch.results,
              })
            );
          } else {
            console.log('search lookup:', json.search);
            searchPage
              .goto(
                `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURI(json.search)}`,
                { waitUntil: 'load' }
              )
              .then((res: any) => {
                console.log('search status:', res.ok());
                searchPage
                  .evaluate(() => {
                    const divs = document.querySelectorAll(
                      'section > article > div > div > div:nth-child(4)'
                    );
                    const good = Array.from(divs)
                      .filter((d) => {
                        return (
                          ['chords', 'tab', 'bass'].indexOf(d.textContent) > -1
                        );
                      })
                      .map((qualify) => {
                        const anchor = qualify.parentNode.querySelector(
                          'div:nth-child(2) > header > span > span > a'
                        );
                        let artistDiv: HTMLElement =
                          qualify.parentElement as HTMLElement;
                        let artist = artistDiv.querySelector(
                          'div:nth-child(1) > span'
                        ).textContent;
                        while (artist === '') {
                          artistDiv =
                            artistDiv.previousElementSibling as HTMLElement;
                          artist =
                            artistDiv.querySelector('div > span').textContent;
                        }
                        return {
                          type: qualify.textContent,
                          song: anchor.textContent,
                          href: anchor.getAttribute('href'),
                          artist: artist,
                        };
                      });
                    return good;
                  })
                  .then((results) => {
                    if (results.length > 0) {
                      console.log('search retrieved length:', results.length);
                      const res = {
                        search: json.search,
                        results: results,
                      };
                      searchResults.push(res);
                      ws.send(JSON.stringify(res));
                    } else {
                      console.log('empty search');
                      searchResults.push({ search: json.search, results: [] });
                      ws.send(
                        JSON.stringify({
                          search: json.search,
                          results: [],
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
