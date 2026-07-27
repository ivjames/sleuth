/* Browser end-to-end test: load the page, start a game, and exercise BOTH
   outcomes using the engine's own (test-only, ?sleuthtest) knowledge of the
   solution — a correct accusation must WIN, a wrong one must KILL you — while
   asserting there are no console errors. Run: node test/browser.smoke.js
*/
const { chromium } = require('playwright');
const path = require('path');

async function startGame(browser, errors) {
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto('file://' + path.resolve(__dirname, '../index.html') + '?sleuthtest=1');
  await page.click('#start-btn');
  await page.waitForSelector('#game-screen:not(.hidden)');
  return page;
}

async function accuse(page, { who, weapon, room }) {
  await page.click('button[data-cmd="accuse"]');
  await page.waitForSelector('#accuse-modal:not(.hidden)');
  await page.selectOption('#acc-suspect', who);
  await page.selectOption('#acc-weapon', weapon);
  await page.selectOption('#acc-room', room);
  await page.click('#acc-confirm');
  await page.waitForSelector('#end-modal:not(.hidden)');
  return page.evaluate(() => ({
    title: document.querySelector('#end-title').textContent,
    cls:   document.querySelector('#end-title').className,
  }));
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];

  // ----- 1. basic interactivity + accuse modal populates -----
  let page = await startGame(browser, errors);
  for (const cmd of ['help', 'look', 'notebook', 'wait', 'n', 'e', 'question']) {
    await page.fill('#cmd-input', cmd);
    await page.press('#cmd-input', 'Enter');
  }
  const counts = await page.evaluate(() => {
    document.querySelector('button[data-cmd="accuse"]').click();
    return {
      suspects: document.querySelectorAll('#acc-suspect option').length,
      weapons:  document.querySelectorAll('#acc-weapon option').length,
      rooms:    document.querySelectorAll('#acc-room option').length,
    };
  });
  await page.click('#acc-cancel');

  // ----- 2. CORRECT accusation => WIN -----
  const truth = await page.evaluate(() => {
    const G = window.__sleuth.G, R = window.__sleuth.ROOMS;
    return { who: G.murdererName, weapon: G.weapon.name, room: R[G.murderRoom] };
  });
  const winRes = await accuse(page, truth);
  await page.close();

  // ----- 3. WRONG accusation => DEATH -----
  page = await startGame(browser, errors);
  const wrong = await page.evaluate(() => {
    const G = window.__sleuth.G, R = window.__sleuth.ROOMS;
    const notMurderer = G.suspects.find(n => n !== G.murdererName);
    return { who: notMurderer, weapon: G.weapon.name, room: R[G.murderRoom] };
  });
  const loseRes = await accuse(page, wrong);
  await page.close();

  await browser.close();

  const checks = [
    ['selects populated', counts.suspects >= 5 && counts.weapons === 8 && counts.rooms === 16],
    ['correct accusation wins', /SOLVED/.test(winRes.title) && /win/.test(winRes.cls)],
    ['wrong accusation kills', /DEAD/.test(loseRes.title) && /lose/.test(loseRes.cls)],
    ['no console errors', errors.length === 0],
  ];
  const failed = checks.filter(([, ok]) => !ok);
  if (failed.length) {
    console.error('SMOKE FAIL:', failed.map(([n]) => n).join(', '), { counts, winRes, loseRes, errors });
    process.exit(1);
  }
  console.log(`OK — interactivity, win path, and death path all verified; ${counts.suspects} suspects / ${counts.weapons} weapons / ${counts.rooms} rooms; 0 console errors.`);
})();
