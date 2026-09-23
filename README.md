# Super 7 Live

**Live addresses**
- Student link: https://markadams88.github.io/super7-live/index.html
- Teacher screen: https://markadams88.github.io/super7-live/teacher.html
- Connection test: https://markadams88.github.io/super7-live/loadtest.html
- Code: https://github.com/markadams88/super7-live (GitHub Pages from main, root)
- Database: Firebase project `aums-super7`, Realtime Database in Belgium (europe-west1)
- Teacher PIN: 7777 (change it in firebase-config.js and re-upload that file)

To change any file: open the repository on GitHub, Add file > Upload files, drop the new
copy on top (same name), Commit. Pages redeploys in about a minute; hard-refresh with
Ctrl+Shift+R to see it.

## Built for 500 at once

The original version showed every student as a live whiteboard tile. That is lovely with
30 and impossible with 500: the teacher's browser would be receiving every stroke from
every student, continuously. The rebuild (September 2026) changes three things.

**Students send almost nothing.** Each student's page subscribes to exactly three small
nodes: the session state, a note addressed to them, and a request for their board. It
never subscribes to a list of other students. A whole You do costs about **80 bytes**
per student, measured, not estimated.

**Boards stay on the student's own device** until you ask for one. Click a name on the
teacher screen and that one student starts sending their board, live, until you close
the panel. Nothing is transmitted the rest of the time.

**Everything uses child listeners.** A `value` listener on a node with 500 children
re-sends all 500 every time one changes. `child_added` and `child_changed` send one
child. That is the difference between a teacher screen that keeps up and one that does not.

Measured on a simulated full room: 500 students appeared on the teacher screen in
**0.4 seconds**, the tally and the wrong-answer groups were correct, searching for a name
took **150 ms**, and the page held **60 fps** with a worst frame of 21 ms.

## The one thing that must be done before a big session

Firebase's free **Spark** plan allows **100 simultaneous connections**. Student 101
simply cannot connect. The **Blaze** plan raises that to **200,000** and is pay as you go.

At the data volumes above, a 500-student session moves roughly 40 MB of traffic in total,
and Blaze includes 10 GB of downloads a month before anything is charged, so a full term
of Super 7 should sit inside the free allowance. Set a budget alert anyway:
Firebase console > Usage and billing > Details and settings > Modify budget alerts.

Open `loadtest.html`, put in 500, and press Run. If it stalls at about 100 the project is
still on Spark. If all 500 connect you are fine.

## What it does

**Students** (`index.html`) open the link on a phone, tablet or laptop, type a first name
and initial, and wait. When you push a You do, the question appears with a writing board,
an answer box and an instant tick or cross. **A correct answer opens the extension
straight away**, with no action from you: one harder question, then a line telling them to
wait for the next one, so the class stays together. On the grid page they can open any of
the twelve, work on a board, and see answers and worked solutions once you release them.

**You** (`teacher.html`, PIN protected) see a live tally: how many are in the room, how
many have answered, how many are right, the percentage, and how many have finished the
extension. Under that, the wrong answers people are actually giving, grouped and counted,
which tells you what to reteach before you say a word. Under that, every student's name
with a tick, a cross or a star. Click any name to watch that student's board live, send
them a note, or remove them.

## Running a session

1. Open `teacher.html`, enter the PIN, choose the week, press **Start session**.
2. Students use the same link every week, so there is nothing to send round.
3. Use the buttons along the top: **Lobby**, **You do 1 to 10**, **The twelve**, **Finish**.
4. On a You do: watch the tally and the wrong answers. Click a name if someone needs a nudge.
   **Reveal solution** when you go through it on the deck.
5. On The twelve: **Show answers** after the session, **Show solutions** for the full working.
6. **Reset** wipes every student, answer, note and board for that session.

## Files

- `index.html` student screen, `teacher.html` teacher screen, `loadtest.html` connection test
- `shared.js` sync layer (Firebase or a local demo store), answer checking, the drawing board
- `app.css` all the styling
- `firebase-config.js` project config and the teacher PIN
- `packs/weekNN.js` one week's You dos, extensions and twelve, generated from the deck by
  `engine/makepack.js`. Add the new week to `packs/index.js` when you add a pack.
- `database.rules.json` paste into the Firebase console Rules tab and publish

## Data layout

```
s7/current                     the session id that is live
s7/sessions/<sid>/meta         {pack, started}
s7/sessions/<sid>/state        {mode, key, reveal, gridAns, gridSol}
s7/sessions/<sid>/st/<uid>     {n:name}            presence, removed on disconnect
s7/sessions/<sid>/an/<q>/<uid> {n,v,c,x}           answer, correct, extension done
s7/sessions/<sid>/msg/<uid>    {t:text}            a note from you to one student
s7/sessions/<sid>/req/<uid>    <question number>   you are watching this student
s7/sessions/<sid>/bd/<uid>     strokes             only while you are watching
```

With no Firebase config the app runs in **local demo mode**: teacher and student tabs in
one browser talk to each other, which is enough to rehearse the whole session.

## Look and feel

Built to the Aston University brand guidelines: Deep Purple (#610064) as the ground,
white type, the three secondary colours (purple, orange, pink) used only for the three
pillars, and the tertiary palette (blue, green, grey) used only for the teacher's data.
Sentence case throughout, square corners, very little motion.

- `assets/brand.svg` the Aston University Mathematics School logo, traced to a vector
  from the official PNG so it stays sharp at every size
- `assets/` favicon, home-screen icons and `og.png`, the preview card Teams and
  WhatsApp show when the link is pasted
- `vendor/fonts/` Schibsted Grotesk, the closest free match to Aktiv Grotesk (which is
  licensed for print, not the web). Self-hosted, so no third-party font calls. OFL licence
  included.
- `site.webmanifest` lets students add Super 7 to their home screen as an app
- The three pillars are drawn in `S7.pillars` (shared.js) and placed per screen in
  `app.css`; the positions change slightly from screen to screen so the session feels
  like one continuous story.
