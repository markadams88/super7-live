# Super 7 Live

The live student app for the Super 7 sessions. One copy serves every week: you pick the week's question pack from the menu, students open one fixed link.

## What it does

**Students** (`index.html`) open the link on a phone, tablet or laptop, type a first name and initial and wait. When you push a You do, the question appears with a writing board (finger, stylus or mouse), an answer box and an instant tick or cross. A comment from you pops up on their screen. If you send them the extension they get a second board underneath with the "great, have a go at this before we move on" message. On the grid page they can open any of the twelve, do it on a board, and see answers and worked solutions once you release them.

**You** (`teacher.html`, PIN protected) see every student as a live tile: name, their board, their typed answer and a tick or cross. Click a tile to open that student full size, type a comment (or tap a quick one), send the extension, or remove them. Tick several tiles, or press "Select all correct", then "Send extension to selected". Reveal the worked solution to everyone with one button. Silly names: hover a tile and press the cross, or use Remove in the focus view. They can rejoin with a proper name.

## Running a session

1. Open `teacher.html`, enter the PIN, choose the week, press **Start session**.
2. Paste the student link (bottom of the teacher page) into the Teams chat.
3. Use the buttons along the top: **Lobby**, **You do 1 to 7**, **The twelve**, **Finish**. Whatever you press is what every student sees.
4. On a You do: watch the tiles, click into anyone who needs a nudge, select the students with a tick and send the extension, then **Reveal solution** when you go through it on the deck.
5. On The twelve: **Show answers** after the session (or straight away if you prefer), **Show worked solutions** for the full working.
6. **Reset** wipes every student, board, answer and comment for that week's session. Do it before the session starts if the same pack was used for a rehearsal.

The deck's "Live" button (bottom bar) opens the teacher screen in a new tab.

## Hosting

The app is static files, so GitHub Pages hosts it for free. The live sync needs a Firebase Realtime Database (also free at this scale):

1. Firebase console: create a project, add a Realtime Database (Europe region, start in test mode), then Project settings > Your apps > Web app > copy the config object.
2. Paste it into `firebase-config.js` as `window.S7_FIREBASE = {...}` and change `S7_TEACHER_PIN`.
3. In the database Rules tab, paste the contents of `database.rules.json` and publish.
4. Push the folder to a GitHub repository, Settings > Pages > deploy from the main branch, root.

With no Firebase config the app runs in **local demo mode**: the teacher and student tabs in the same browser talk to each other, which is enough to try everything out.

## Adding a week

Build the week's deck as usual, then run `node makepack.js weeks/weekNN app/packs` from the build toolkit; that writes `packs/weekNN.js`. Add `'weekNN'` to the list in `packs/index.js`. Push. The new week appears in the menu.

## Data and privacy

Students give a first name and initial only. Everything a session stores is the name, the strokes on their board, their typed answers and your comments to them, all under that week's session, and Reset deletes the lot. The database rules only allow writes under `s7/`. The teacher PIN is a lock on the door, not a safe: anyone determined could read it from the source, so change it each term and reset sessions after use.
