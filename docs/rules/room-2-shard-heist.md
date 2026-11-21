# Room 2 · The Chase

> This document describes the rules in `room-2-chase/js/core.js`, and the pickups and police in `room-2-chase/js/game.js`.

## Where room 2 starts

Room 2 begins where room 1 ends. You (inmate 4471, the framed detective) have climbed out of the tunnel under Cell Block D. It is about 02:30 at night. In a lock-up garage, Officer Hale's getaway vehicle is waiting. Every police car in town is now hunting the escaped inmate.

**Officer Hale is a secret ally.** He believes you were framed, but he cannot prove it. In the story mode he helps over the radio; his messages are shown in **orange**, the colour of room 1. Police dispatch messages are **red**.

### The garage (Lisbon)

A run in Lisbon begins in that garage, 30 m under the Baixa, and on foot. You are the same person as in room 1: you walk with the arrow keys or W A S D, briskly (3.4 m/s), and run while you hold Shift (5.6 m/s), turn your head by dragging, and see your own hands in the striped sleeves; the walk, the head movement, the hands and the echo of your steps are room 1's. It begins where room 1 ended: in the tunnel from Cell Block D, behind its old plank door. The tunnel is built as in room 1 and from the same scanned surfaces (stone walls, a brick vault, old pavers, the wooden ladder at its far end, two old bulbs). The door swings open and you walk out through it into the garage by yourself, in under three seconds; then you have the controls (with reduced motion you stand in the garage at once, the door open behind you). The doorway is in the wall beside the ramp, and the three getaway vehicles stand across the hall in their bays, numbered 01 to 03 on the far wall, under rows of strip lights: the moonlight of the city does not reach down here.

- **Choose:** walk up to a vehicle, or tap it on the card (you then walk to its driver's door). The one you stand at is the chosen one. This is the same choice as in the menu, so the menu's vehicle is the one marked when you arrive.
- **Get in:** you run to the driver's door. Your right hand hooks its fingers under the handle and pulls it out of its pocket, the latch clicks, the door comes open with the hand, and you step back as it swings wide; you get in through it, head down under the roof, onto the seat, take the wheel with both hands, and your left hand pulls the door shut. Only now is an engine heard: on foot the garage is quiet apart from your steps. For a moment you sit in the cabin: in the coupe a dashboard with two dials under a hood, the screen of the navigation with the route through the old town, the centre stack with vents, the climate panel and the start button, the gear lever, leather bucket seats and a small bench behind them; in the truck a high dashboard, the hump of the engine between two seats and the bunk behind. The engine starts, the lights and the dials come on, and the needles sweep once to the end of their dials and back. The vehicle rolls out of its bay, still seen from the seat, and then the view draws back out of the cabin to its place behind the vehicle. The motorcycle has no door: you swing onto the seat and take the bars. *Esc* at the wheel puts you back on your feet beside the door.
- **Drive out:** drive up the ramp (at most 32 km/h down here). Walls, pillars and the two parked vehicles stop you, but a bump costs only speed, never damage. Over the top of the ramp the vehicle drives itself: a roller door rolls up, and you drive straight out onto the street, with no cut and no fade, across the pavement and round to the left into the lane. The door is in the house north-east of the usual start, on the cross street, and every run in Lisbon can see it there. As soon as you are on the street the map of the evidence opens.
- **Nothing counts in the garage:** the clock does not run, no police come, and the HUD is hidden. The run starts with *Start driving* on the map, as before.
- *Skip the garage* goes straight to the street, to the usual start. *Try again* and *Restart* skip it too. The story begins in the garage as well.

Room 2 plays no sound files, so the steps here are synthesised, where room 1 plays recordings.

## Two ways to play

- **Free ride:** pick a getaway vehicle, then escape from Lisbon.
- **Story mode, *The Necklace Job*:** the same run through Lisbon with Officer Hale on the radio, a hidden letter and three endings.

## Vehicles

| Vehicle | Top speed | Acceleration | Handling | Damage taken | Ramming |
|---|---|---|---|---|---|
| **Car** (muscle coupe) | 100 % | 100 % | 100 % | 100 % | 1.0 |
| **Motorcycle** (superbike) | 112 % | 130 % | 140 % | 100 % | 0.4 |
| **Truck** (tractor unit) | 78 % | 70 % | 72 % | **55 %** | 2.4 |

Percentages are relative to the map's top speed and to the car. The menu shows the same values as bars (1–5) and as km/h and 0–80 km/h times, computed from these numbers.

## The map

| Map | Goal | Time | Car top speed | Police top speed | Evidence | Repair kits |
|---|---|---|---|---|---|---|
| **Lisbon · Baixa** | Collect **all 6 pieces of evidence**, pick up the **witness**, then drive through the golden gate that appears at the south-west corner of the Baixa (Rua do Crucifixo at the river avenue), on the way to the 25 de Abril bridge | 3:00 | 122 km/h | 108 km/h | 6 pieces of evidence | 3 |

- There is one map, Lisbon. (The highway and the countryside of earlier versions, and the story acts played on them, were removed.)
- A piece of evidence is picked up within 3.8 m; a repair kit within 3.6 m, and only when you have damage.
- Lisbon has traffic lights, 26 other cars, two white city buses, four motorcycles and three yellow trams. The trams only run on their tracks, a stone track bed with two rails set into the road: a clockwise loop through Rua da Conceição, Rua da Prata, the north side of the Praça do Comércio and Rua Áurea. As on real Lisbon streets, cars and the player can drive over the tracks. Each wheel that rolls over a rail gives a jolt: the picture and the vehicle shake, the rail clacks, and phones that can vibrate give a short buzz. The faster you go, the harder the jolt; the front wheels hit first and the rear ones a moment later. Driving along the stone track bed rumbles lightly. The trams themselves run on steel railway wheels with a flange on the inside, on a two-axle truck with springs and brake blocks. The buses are 12 m long, so at a crossing they go straight on or turn left in the wide arc, never right into the tight corner (unless that is the only way left at the edge of the map). Everything stops at red lights and keeps its distance to the back of the vehicle ahead, so nobody runs into the long tail of a bus or a tram.
- **Other vehicles at night:** every vehicle throws its headlights on the road ahead, so a car waiting at a dark crossing can be seen from far away. Its bright brake lights are on while it slows down or stands. You can crash into buses and motorcycles like into any other vehicle, and a hit pushes the other vehicle away by weight: a motorcycle (weight 0.25) flies off, two cars (1 each) both give way, a bus or coach (4) or a lorry (3.5) hardly moves and you bounce off it; a tram on its rails does not move at all. Your motorcycle weighs 0.3, your truck 3.5. A hit off the middle turns the other vehicle; it slides at most 14 m, stops at walls, lamp posts and parked cars, and drives back into its lane once its driver has recovered. You keep more of your speed the lighter the vehicle you hit, and each hit sounds like what you hit: a motorcycle clatters, a bus booms.
- **Parked cars:** the cars parked along the kerbs in Lisbon can be pushed away too. Their handbrake is on, so they count 1.6 times their weight (a car 1.6, an SUV about 2.1): a hit at city speed shoves one a few metres, and it turns when you hit it off its middle. It stops at houses, lamp posts and other parked cars (and pushes those on), never more than 7 m from its place, and stays where it comes to rest until the next run. You keep more speed than against a wall, but the hit still counts as a crash. Traffic stops behind a parked car that has been pushed into its lane.
- Each map has an edge you cannot cross. When you near it the screen turns red and a "turn back" arrow appears. In Lisbon the outer streets are part of the map, so there this only happens when you head for the edge.

## The evidence in Lisbon

In Lisbon you do not collect star shards. Your oldest friend on the force found out who really broke into the naval museum and hid the proof across the Baixa (room 1 tells this in its briefing). There are six pieces, one of each, in random places every run. Each floats above the street with a glow, and the panel at the top left shows one icon per piece that lights up when it is in the car.

| Evidence | What it proves |
|---|---|
| **Photos** | A figure at the museum window at 01:40 on the night of the theft, while you were at home |
| **Fingerprints** | Fingerprints and DNA traces from the display case, and they are not yours |
| **Torch** | The thief's torch, dropped in the museum garden, with paint from the window frame on it |
| **Lockpick** | The museum's lock was opened with these picks, not forced |
| **Clothes** | The dark clothes from the photos, with glass splinters from the display case in the seams |
| **Balaclava** | The balaclava from the photos, with hairs inside that are not yours |

**Before you drive** a map of the Baixa shows where the six pieces lie, with their names, the repair kits, your start and the gate. The clock waits until you press **Start driving**. **While you drive** an arrow on the screen (at the bottom in the middle; on an upright phone under the pursuit panel) points to the nearest piece still out there, with its name and distance; once all six are found it turns gold and points to the witness, and once she is in the car, to the gate. (The story's sealed letter is on neither.)

**The witness.** With all six pieces in the car, one thing is still missing: a person. **Marta Silva**, a night-shift nurse, saw the real thief climb out of the museum window, and she will say so in court. She waits on a pavement somewhere in the Baixa, 70 to 200 m from where you are, with a golden light over her head. She turns to face your car and waves: now and then while you are far away, and without stopping once you are closer than 45 m. The radar shows her in gold (an arrow at the rim while she is out of range), the signal bars point to her, and a seventh icon appears in the panel. Stop next to her, closer than 7 m and slower than about 11 km/h, and she runs to the passenger door on the right. Once the vehicle stands still, she opens the door, steps in (up the steps into the truck's cab), sits down and pulls the door shut; on the motorcycle she climbs onto the pillion seat. Getting in takes about one second, and the vehicle waits for her. From then on she rides along beside you, visible through the window, over the bridge as well. Drive off before she reaches the vehicle (more than 12 m away) and she goes back to wait. With her on board, the golden gate opens at the south-west corner of the Baixa, where Rua do Crucifixo meets Avenida Infante Dom Henrique by the river. It faces the 25 de Abril bridge, and driving through it takes you onto the bridge.

**The story card.** As soon as Marta has shut the door, the run pauses and a card in the middle of the screen tells what she saw and where to go now. Nothing moves until you close it (the button, `Enter`, or a tap); the clock and the police wait as well.

**The yellow arrows.** From then on yellow arrows lie on the road, one every 5 m in your lane, and show the way through the streets to the gate, round every corner. They are worked out again as you drive, so after a wrong turn they simply show a new way. A pulse runs along them towards the gate. The police keep chasing you while you wait for her.

**The finale.** Behind the gate starts the approach road to the bridge, built after the real one: a concrete viaduct on tall twin piers that runs west along the river, passes under the side span and climbs round in a banked loop to the deck, 42 m up. Drive through the gate and the game takes the wheel for good: the clock stops, the police give up, and the vehicle drives itself up the approach road to the bridge, on the side of the road it came through the gate on. The keys, the touch pads and the tilt do nothing from here on. If it comes through the gate at an angle or very fast it may still touch a concrete parapet (scraping along one throws sparks, a hard knock slows it down); from 90 m on the barrier in the middle keeps it on its side. The long straight along the river is not shown in full: 2.5 seconds behind the gate the picture cuts, as in a film, to a helicopter shot high outside the loop, where your vehicle is now 25 m before the curve, in its lane and at its speed (at least 65 km/h). The camera follows it into the loop for 4 seconds and then cuts back behind it. A vehicle that is already close to the loop is not moved. On the deck the drive goes on without a cut: you are on the **25 de Abril bridge** with Marta beside you, driving south over the Tejo, sliding over into the right-hand lane, while the first light of the morning comes up in the east. The heroic music (brass, strings and timpani, about 14 seconds, on the music volume) starts 80 m before the deck, while you are still coming up the loop. From then on the engine fades out bit by bit under it, over 6 seconds, until only the music is left (the vehicle still cruises at about 86 km/h, changes down and accelerates to about 125 km/h). There is nothing more to do: no police, no helicopter. Then the result card. The drive over the bridge does not count towards your time. In the story, it ends act 1.


## The city map: Lisbon's Baixa

The Baixa is the centre of Lisbon, rebuilt as a street grid after the 1755 earthquake. The map is a simplified version of it: the blocks are square, and the grid has 7 streets each way. The real Baixa has a few more, so some are left out. The real Baixa is also flat; the hills on this map are a game decision.

| Direction | Streets, in their real order |
|---|---|
| West to east | Rua do Crucifixo, Rua Áurea, Rua dos Sapateiros, **Rua Augusta**, Rua dos Correeiros, Rua da Prata, Rua dos Fanqueiros |
| North to south | Rua de Santa Justa, Rua da Vitória, Rua de São Nicolau, Rua da Conceição, Rua do Comércio, Praça do Comércio (north side), Avenida Infante Dom Henrique |

- In free ride, the panel at the top left shows the street or square you are on. In story mode it shows the act instead.
- You start on Rua Augusta, facing south towards the Arco da Rua Augusta.
- **Squares:** the Rossio and the Praça da Figueira in the north, the Praça do Comércio by the river in the south. The statue on the Praça do Comércio stands in the middle of the road, so traffic passes on both sides.
- **Landmarks you can see but not reach:** the river Tejo, the 25 de Abril bridge with its stepped concrete anchor blocks and its approach viaduct (you only drive on them in the finale), the wooded side of the west hill that faces the bridge, the castle hill, and across the river the town of Almada: a stone quay wall about 4 m above the water with a walk along the top, houses standing back behind it, an ochre cliff and on top of it about 1,250 houses in the pastel colours of Lisbon: small two-storey houses with shutters, town houses with shops and iron balconies, and a few apartment blocks, with hipped tile roofs and windows that are lit at night. The houses stand in rows along streets, with umbrella pines and cypresses between them and all over the cliff. Above it stands Cristo Rei, the floodlit statue of Christ with outstretched arms on its tall four-pillar pedestal, facing Lisbon. The river moves: long swells and fine ripples, it mirrors the sky towards the horizon, and the lights of the far bank tremble on it as long streaks. The Santa Justa lift stands on the map, and you can crash into it.
- **Parks:** there are three, which the real Baixa does not have. The story needs them for the sealed letter.
- **Houses:** closed blocks of Pombaline houses, wall to wall, as the Baixa was rebuilt after 1755: a ground floor plus 3 to 5 floors (OpenStreetMap gives most buildings 5 levels), arched stone ground floors with old shop fronts, the tallest windows and the balconies on the first floor, limewash colours, and tile roofs with dormers. Tiled fronts are the exception, as they are in the real Baixa.
- **Real buildings in their place:** the National Theatre and Rossio station north of the Rossio, the yellow arcades and corner towers of the Praça do Comércio, and the Sé, seen at the end of Rua da Conceição. Their position is simplified, and they are modelled freely, not measured.
- It is always about 02:30 at night. The clock on the arch shows it.

### How the map was made

The city is a hand-built model of the real Baixa, not map data loaded by the game.

1. **Reference.** We used [OpenStreetMap](https://www.openstreetmap.org/copyright) (© OpenStreetMap contributors, ODbL) as the reference. From it we took the names of the streets and squares, the order in which they follow each other from west to east and from north to south, where the squares and the river front lie, the route of the tram loop, and the usual height of the buildings (most have five levels).
2. **Simplified layout.** The real Baixa is a rectangular grid, rebuilt after the 1755 earthquake, so it fits a game well. We drew it as a regular grid of 7 × 7 streets: square blocks of 48 m and streets 14 m wide. The real blocks are longer than they are wide and vary in size, and there are a few more streets, so the order is real and the measurements are not.
3. **Written into the code.** The street names and the grid are fixed in `room-2-chase/js/core.js` (the `BAIXA` table, with `streetAt` naming the street under the car). The game ships no map file and calls no map service or API while it runs. It needs no key and keeps working if a map service is down.
4. **Landmarks modelled by hand.** The Arco da Rua Augusta, the Praça do Comércio, the Rossio with the National Theatre and the station, the Santa Justa lift, the Sé, the castle hill, the 25 de Abril bridge, Cristo Rei and Almada were modelled from how they look and placed where they roughly stand, not from measured plans. Some are changed on purpose: the bridge has a main span of 300 m instead of 1,013 m so it fits the view, the hills and the three parks were added for the game, and the finish gate stands at the south-west corner, towards the bridge.

## Driving

| Rule | Value |
|---|---|
| Top speed | map top speed × vehicle speed, **minus up to 40 %** at 100 % damage |
| Throttle | never pushes you above the top speed |
| Brake | slows you down, then reverses, up to 40 km/h backwards |
| No pedal | the car rolls to a stop |
| Handbrake (`Space`) | slows you quickly and turns sharper |
| Headlights | always on: a wide, soft beam that lights the road ahead and fades into the dark |
| Brake lights | on while you brake, in either direction, and with the handbrake while moving |
| Reversing lights | white, on while you roll backwards |
| Skid marks and tyre squeal | with the handbrake above about 15 km/h, when braking above about 30 km/h, and in very fast corners (above about 80 km/h, steering hard). They only mark the road, and they are cleared when a new run starts |

**Hills.** Lisbon has hills, up to about 20 % steep. The Arco and the river front are level. Uphill your top speed falls by up to 16 % and gravity pulls you back, half as strongly as it pushes you downhill. Downhill your top speed rises by up to 22 % and you coast on. The truck feels slopes most, the motorcycle least. Brakes and rolling friction hold a stopped vehicle in place.

**Smooth picture.** If the game runs below 48 frames per second for 2 seconds, it lowers the resolution one step (85, 70, then 60 %). If that does not help, the step is taken back. After 20 seconds at 57 or more it goes back up, at most twice. The choice of Ultra or Balanced stays yours.

## Damage

| Rule | Value |
|---|---|
| Crash | impacts under 4 m/s (about 14 km/h) are free; above that, damage = (impact − 4) × 1.0 × the vehicle's damage factor. A wall at 122 km/h costs the car 30 %, the truck 17 %. One crash counts once: for 0.35 s after contact, only a harder hit costs more |
| Scrape | sliding along a wall or another vehicle faster than 3 m/s (about 11 km/h), measured along the surface, throws sparks and grinds, harder the faster you slide (full at 22 m/s). Along house walls and parked cars it leaves pale scratches with a little of your paint; the newest 400 stay. A scrape costs no damage; only the part of your speed into the wall counts as a crash |
| Nitro | every third piece of evidence or shard you pick up fills one nitro charge, three at most (with a full tank the next fill is lost). In Lisbon that is a charge after the 3rd and the 6th piece. `E` or the flame button fires one: for 2.5 s your top speed is 30 % higher and the vehicle is pushed forward with 14 m/s² on top of the engine, a blue flame burns behind it and the view widens. One burns at a time, not while reversing, and only during a run. Afterwards the speed falls back to the normal top speed. The charges are shown under the damage bar; the bar beside them fills towards the next charge and drains while one burns |
| 25 % damage | the paint shows dents (deepest at the nose and the tail), long scratches and dirt, and loses its shine as the damage grows; thin grey smoke rises from the engine |
| 50 % damage | warning: "Engine damaged: top speed reduced." Loose parts and a smashed light; the engine misfires; the smoke turns dark |
| 75 % damage | hood up (car), screen gone (motorcycle), hanging bumper and cracked windscreen (truck); a thick black column of smoke; sparks at speed |
| 88 % damage | the engine is on fire |
| **100 % damage** | **vehicle wrecked: game over** |
| Repair kit | removes 40 % damage, and the damage you see goes with it |
| Kit arrow | from 20 % damage on, a green arrow on every map points to the nearest repair kit still lying there, with its distance (above the evidence arrow in Lisbon) |

## Police

| Rule | Value |
|---|---|
| First police car | after 4 seconds |
| **Wanted stars** | 1 to 5, shown under the clock. A new star every fifth of the time limit or of the way to the end (evidence in the city, distance on the open roads), whichever is further along. Each wrecked police car counts as 4 % more. Stars never fall. |
| New police car | until the number for your stars is reached, see the table below |
| Ramming | every hard hit lowers a police car's health by impact × your ramming power × 0.09; a police car is wrecked when its health is gone and comes back after the time in the table below |
| **Police wreck** | stays where it stopped: lights out, dented and dull, sagging to one side and smoking for about 14 s. Traffic stops behind it, and you and the police can crash into it. It is cleared when you are more than 260 m away, or after 30 s once you are more than 70 m away. When that car is sent back into the chase, it comes back clean |
| Far behind | a police car more than 140 m away drives 20 % faster; one more than 230 m away in the city, or 320 m on the open roads, is sent back near you with full health |
| Hills | police slow down uphill and speed up downhill as you do; other traffic keeps its speed |
| **Bust meter** | fills while a police car is **within 7 m** and you are **slower than 4.5 m/s** (about 16 km/h): full in 3.5 s. Otherwise it drains (empty from full in 2 s). |
| **Head start with the witness** | while Marta gets in, and for 5 s after you close her card, the bust meter does not fill (it only drains), and every police car in the chase loses 2.5 s |
| **Busted** | bust meter at 100 %: game over |

| Stars | Police cars | Police speed | New car every | Wrecked car returns after | Health |
|---|---|---|---|---|---|
| ★ | 1 | 100 % | 3 s | 9 s | 3 |
| ★★ | 1 | 100 % | 3 s | 9 s | 3 |
| ★★★ | 2 | 102 % | 3 s | 8 s | 3 |
| ★★★★ | 3 | 104 % | 2.5 s | 6 s | 3.5 |
| ★★★★★ | 3 | 106 % | 2 s | 4.5 s | 4 |

**Helicopter.** After 60 seconds on the run (or sooner with the fifth star), a police helicopter joins the chase for the rest of the run and hunts you with its searchlight. Its searchlight follows you at 94 % of the police speed. While you are in the light (within 9 m of its centre), the police drive 6 % faster, and in the city they see you from 170 m instead of 110 m. It cannot bust you or damage you. An undamaged car or motorcycle at full speed on a clear, level road stays ahead of the light; the truck, and a badly damaged car, cannot.

## Radio

Seven stations, or off: Reggae, Techno, Hardstyle, Schlager, Sing-Along Pop, Classical and Heavy Metal. Choose in the menu, or at any time with `R` or the radio button. The music plays while you drive, and is silent in the menu and in pause.

All of it is composed and synthesised by the game, with no music files. The tunes are generated by the game. The classical station plays Bach and Beethoven, whose works are in the public domain.

## Ending a run

| Result | When |
|---|---|
| **Clean getaway** | Reach the gate, with the six pieces of evidence and the witness; the drive over the bridge follows |
| **Busted** | the bust meter is full |
| **Wrecked** | damage reaches 100 % |
| **Time's up** | the clock reaches 0:00 |

## Stars and best times

- **Drive time.** The time used on the clock.
- **Stars:**

| | ★★★ | ★★ | ★ |
|---|---|---|---|
| Lisbon | more than 40 % of the time left | more than 20 % left | otherwise |

- These limits are for the car. For the other vehicles the drive time counts multiplied by their speed factor (motorcycle 1.12, truck 0.78), so each can earn three stars.
- More than 50 % damage costs one star, but never the last one.
- The best drive time per map is saved in the browser. Saved values under 10 s or over 15 minutes are ignored, because no run can take that long or that little.

## Drivers and the leaderboard

- **Driver.** In the main menu (section 03) you type a driver name and press **Play online**: you are on the online leaderboard at once, with no email and no password. The driver belongs to this browser. A name keeps letters, digits, spaces and `. _ ' -`, up to 16 characters; capital letters do not matter, so *alex* and *Alex* are the same driver, and a name someone already has is refused. If you want the same driver on several devices, open *Use an email account instead* and sign up with email and password.
- **Leaderboards.** Every finished free ride goes on two boards under the active driver: the **all-time** board and the board of the **current calendar month**. Each driver has one entry per board, their best time; a slower run never replaces it. The fastest time is first, and on a tie the time that was there first stays ahead. When a new month begins, the monthly board starts empty; the all-time board stays.
- **Leader of the month.** The fastest driver of the current month on a map is named above the two boards.
- **Where they are shown.** In the main menu (for the map that is chosen) and on the end screen after the finish. Each board shows the top five, and the driver's own place below them if they are further down. The end screen says whether the run is a new personal best and which place it has on both boards. It is set in large type: the drive time is the one big number, with the best time on this device under it, the stars beside the title, and time left (or shards), damage and wrecked police cars next to it. Without a driver, the end screen asks for a name first; the time is saved as soon as the name is entered.
- Runs that end busted, wrecked or out of time, and the story mode, do not go on the board.

## The whole heist (room 1 and room 2 as one time)

- **How it starts.** Only from room 1: after Ending A it opens room 2 by itself and brings the escape time. Room 2 opens in the light of the headlights room 1 ended in; the light clears and you stand in the garage, with no menu and no card in between. A message shows the escape time. **Main menu** on the garage card gives the heist up. As the page was not opened by a click, the sound (and on a phone the motion sensor) starts with your first key or tap.
- **What counts.** The heist is the escape followed by a finished free ride through Lisbon, with any vehicle. **Heist time = escape time + drive time.** The escape time changes nothing in the drive: the same clock, police and evidence as in every Lisbon run.
- **Trying again.** If the drive fails (busted, wrecked, out of time), **Drive again** keeps the heist open, and only the finished drive counts. Going back to the menu ends the heist. Once a heist is finished, the escape time is used up; a new heist starts in room 1.
- **The heist leaderboard.** Shown on the end screen above the board of the map: escape + drive = heist time, under it the best heist on this device (or that this one is the new best) and, signed in, the online record with its driver, then your place, and the top five heists (your own row below them if you are further down), each with its two parts and the vehicle. Each driver keeps one entry, their best heist; a slower one never replaces it, and on a tie the heist that was there first stays ahead. Signed in, it is everybody's board online; otherwise it is the board of this device. The drive also goes on the Lisbon leaderboard as usual.
- **Refused.** An escape time that is broken, under 1 s, over 11 minutes (room 1 cannot last longer), from the future or older than six hours is ignored and the menu opens. Opening room 2 without coming from room 1 never starts a heist. Online, the database accepts only the two parts (escape 1 to 660 s, drive 10 to 900 s), adds them up itself, and takes at most one heist every 10 seconds from an account.
- **What cannot be checked.** The escape time comes from the player's own browser. The rules above keep it possible, but a player who changes their browser's storage can claim a faster escape than they played. The same is true of every time on the boards.
- **Online.** The boards everybody sees are kept in the game's online database. Every run is also kept on this device; when the online board can't be reached, the game says so and shows the boards of this device instead.

## Story mode: The Necklace Job

The story is one act, played in Lisbon. It is the Lisbon run with two things added: Hale and the police dispatch on the radio, and the letter.

| Act | Map | Goal | Special rule |
|---|---|---|---|
| **The Evidence** | Lisbon | Recover the 6 pieces of evidence, pick up the witness, then the gate and the bridge | An optional **sealed letter** is hidden in a park. It is **not shown on the radar**. |

| Ending | When |
|---|---|
| **A · The truth** | You crossed the bridge with the letter: handed to the prosecutor's investigators who wait with Hale on the far side, it proves Lady Ashford staged the theft. Hale gives you your badge back. |
| **B · Back in 4471** | You crossed the bridge without the letter: the evidence and the witness show that someone else broke in, but not who sent him. It is not enough, and you go back to cell 4471. |
| **C · Caught** | Busted, wrecked or out of time: back to Cell Block D. You can try again. |

**Trying again:** a letter found during the failed attempt does **not** count; you have to find it again.

Radio messages (Hale in orange, police dispatch in red) appear at fixed times in each act, each only once.

## Menu actions (accepted and refused)

| Button | Allowed when |
|---|---|
| Start the getaway | in the main menu |
| Story mode | in the main menu, or after the final ending |
| Start act 1 | on the story's opening card |
| Drive again / Restart | after a run, or in the pause menu |
| Resume | in the pause menu |
| Main menu | anywhere except while driving |
| Next act | after a finished act, but not after the last one |
| Retry act | after Ending C, or in the pause menu during a story |

Any other button or action is refused, and no card button works while you are driving.

## Saved settings

The last map and vehicle, the best times, the drivers and leaderboards, the radio station, the graphics, the steering and the three volumes are saved in the browser. Every saved value is checked when loaded; invalid values fall back to Lisbon, Car, radio off and the defaults. All settings are explained in [Settings and options](settings.md).

## Controls

| Input | Action |
|---|---|
| `W A S D` or arrow keys | Drive |
| `Space` | Handbrake |
| `C` (hold) | Look back: the camera turns round and looks down the road behind you for as long as you hold it, so you can see how close the police are. "Rear view" shows at the top. Only while driving |
| `E` | Fire a nitro charge (see Nitro below) |
| `P` / `Esc` | Pause |
| `M` | The large map of the Baixa (Lisbon only); `M` again closes it. A tap on the radar does the same |
| `N` | Sound on or off |
| Volume sliders | In the menu and on the pause card: `Game` (engine, tyres, effects), `Music` (the radio) and `Police` (sirens and the helicopter), 0 to 100 %. They are kept for the next visit |
| `R` | Next radio station (`Shift` + `R` for the one before) |
| `Enter` / `Space` | Press the button in focus. With no button in focus, `Enter` presses the card's main button. While driving, `Space` is the handbrake |
| `Tab` | Move between the buttons of a card |
| Touch pads | Steer on the left; brake and gas on the right. Both together are the handbrake. The round button beside the brake looks back while you hold it; the flame button fires a nitro charge |
| Tilt (phones) | Hold the phone sideways and lower one side, like a steering wheel: from 3° it starts to steer, at 24° it is at full lock. The steering buttons go away while tilt works. Upright, or if the sensor is refused or missing, the buttons stay. Choose `Tilt` or `Buttons` in the menu or on the pause card. The sensor is only read in the browser and nothing is stored or sent |
