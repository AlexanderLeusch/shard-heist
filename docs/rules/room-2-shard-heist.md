# Room 2 · Shard Heist

> This document describes the rules in `room-2-chase/js/core.js`, and the pickups and police in `room-2-chase/js/game.js`.

## Where room 2 starts

Room 2 begins where room 1 ends. You (inmate 4471, the framed detective) have climbed out of the tunnel under Cell Block D. It is about 02:30 at night. In a lock-up garage, Officer Hale's getaway vehicle is waiting. Every police car in town is now hunting the escaped inmate.

**Officer Hale is a secret ally.** He believes you were framed, but he cannot prove it. In the story mode he helps over the radio; his messages are shown in **orange**, the colour of room 1. Police dispatch messages are **red**.

## Two ways to play

- **Free ride:** pick a map and a getaway vehicle, then escape.
- **Story mode, *The Necklace Job*:** three acts on the three maps, in order, with a story and three endings.

## Vehicles

| Vehicle | Top speed | Acceleration | Handling | Damage taken | Ramming |
|---|---|---|---|---|---|
| **Car** (muscle coupe) | 100 % | 100 % | 100 % | 100 % | 1.0 |
| **Motorcycle** (superbike) | 112 % | 130 % | 140 % | 100 % | 0.4 |
| **Truck** (tractor unit) | 78 % | 70 % | 72 % | **55 %** | 2.4 |

Percentages are relative to the map's top speed and to the car. The menu shows the same values as bars (1–5) and as km/h and 0–80 km/h times, computed from these numbers.

## Maps

| Map | Goal | Time | Car top speed | Police top speed | Shards | Repair kits |
|---|---|---|---|---|---|---|
| **Lisbon · Baixa** | Collect **all 6 pieces of evidence**, pick up the **witness**, then drive through the golden gate that appears under the Arco da Rua Augusta | 3:00 | 122 km/h | 119 km/h | 6 pieces of evidence | 3 |
| **Highway** | Reach the finish **4 km** ahead. Shards are optional: **+4 s** each | 1:50 | 200 km/h | 187 km/h | 12 | 2 |
| **Countryside** | Reach the village at the end of the road. Shards: **+4 s** each | 2:30 | 158 km/h | 148 km/h | 10 | 3 |

- A shard or a piece of evidence is picked up within 3.8 m; a repair kit within 3.6 m, and only when you have damage.
- Lisbon has traffic lights, 26 other cars, two white city buses, four motorcycles and three yellow trams. The trams only run on their tracks, a stone track bed with two rails set into the road: a clockwise loop through Rua da Conceição, Rua da Prata, the north side of the Praça do Comércio and Rua Áurea. As on real Lisbon streets, cars and the player can drive over the tracks. Each wheel that rolls over a rail gives a jolt: the picture and the vehicle shake, the rail clacks, and phones that can vibrate give a short buzz. The faster you go, the harder the jolt; the front wheels hit first and the rear ones a moment later. Driving along the stone track bed rumbles lightly. The trams themselves run on steel railway wheels with a flange on the inside, on a two-axle truck with springs and brake blocks. The buses are 12 m long, so at a crossing they go straight on or turn left in the wide arc, never right into the tight corner (unless that is the only way left at the edge of the map). Everything stops at red lights and keeps its distance to the back of the vehicle ahead, so nobody runs into the long tail of a bus or a tram. On the highway traffic drives both ways: cars, SUVs, lorries, three coaches and six motorcycles; lorries and coaches keep to the middle and slow lanes. On country roads there is oncoming traffic, with one coach and three motorcycles among it, and driving off the road cuts your top speed to 55 %.
- **Other vehicles at night:** every vehicle throws its headlights on the road ahead, so a car waiting at a dark crossing can be seen from far away. Its bright brake lights are on while it slows down or stands. You can crash into buses and motorcycles like into any other vehicle.
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

**The witness.** With all six pieces in the car, one thing is still missing: a person. **Marta Silva**, a night-shift nurse, saw the real thief climb out of the museum window, and she will say so in court. She waits on a pavement somewhere in the Baixa, 70 to 200 m from where you are, with a golden light over her head. She turns to face your car and waves: now and then while you are far away, and without stopping once you are closer than 45 m. The radar shows her in gold (an arrow at the rim while she is out of range), the signal bars point to her, and a seventh icon appears in the panel. Stop next to her, closer than 7 m and slower than about 11 km/h, and she walks to the passenger door on the right. Once the vehicle stands still, she opens the door, steps in (up the steps into the truck's cab), sits down and pulls the door shut; on the motorcycle she climbs onto the pillion seat. This takes about two seconds, and the vehicle waits for her. From then on she rides along beside you, visible through the window, over the bridge as well. Drive off before she reaches the vehicle (more than 12 m away) and she goes back to wait. With her on board, the gate under the Arco da Rua Augusta opens. The police keep chasing you while you wait for her.

**The finale.** Drive through the gate and the picture fades: you are on the **25 de Abril bridge** with Marta beside you, driving south over the Tejo at about 86 km/h while the first light of the morning comes up in the east. There is nothing more to do: no police, no helicopter, heroic music (brass, strings and timpani, about 14 seconds, on the music volume). Then the result card. The drive over the bridge does not count towards your time. In the story, it ends act 1.

The highway and the countryside keep their **bonus shards** (+4 s each).

## The city map: Lisbon's Baixa

The Baixa is the centre of Lisbon, rebuilt as a street grid after the 1755 earthquake. The map is a simplified version of it: the blocks are square, and the grid has 7 streets each way. The real Baixa has a few more, so some are left out. The real Baixa is also flat; the hills on this map are a game decision.

| Direction | Streets, in their real order |
|---|---|
| West to east | Rua do Crucifixo, Rua Áurea, Rua dos Sapateiros, **Rua Augusta**, Rua dos Correeiros, Rua da Prata, Rua dos Fanqueiros |
| North to south | Rua de Santa Justa, Rua da Vitória, Rua de São Nicolau, Rua da Conceição, Rua do Comércio, Praça do Comércio (north side), Avenida Infante Dom Henrique |

- In free ride, the panel at the top left shows the street or square you are on. In story mode it shows the act instead.
- You start on Rua Augusta, facing south towards the Arco da Rua Augusta.
- **Squares:** the Rossio and the Praça da Figueira in the north, the Praça do Comércio by the river in the south. The statue on the Praça do Comércio stands in the middle of the road, so traffic passes on both sides.
- **Landmarks you can see but not reach:** the river Tejo, the 25 de Abril bridge (you only cross it in the finale), Cristo Rei and the castle hill. The river moves: long swells and fine ripples, it mirrors the sky towards the horizon, and the lights of the far bank tremble on it as long streaks. The Santa Justa lift stands on the map, and you can crash into it.
- **Parks:** there are three, which the real Baixa does not have. The story needs them for the sealed letter.
- **Houses:** closed blocks of Pombaline houses, wall to wall, as the Baixa was rebuilt after 1755: a ground floor plus 3 to 5 floors (OpenStreetMap gives most buildings 5 levels), arched stone ground floors with old shop fronts, the tallest windows and the balconies on the first floor, limewash colours, and tile roofs with dormers. Tiled fronts are the exception, as they are in the real Baixa.
- **Real buildings in their place:** the National Theatre and Rossio station north of the Rossio, the yellow arcades and corner towers of the Praça do Comércio, and the Sé, seen at the end of Rua da Conceição. Their position is simplified, and they are modelled freely, not measured.
- It is always about 02:30 at night. The clock on the arch shows it.

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

**Hills.** All three maps have hills, up to about 20 % steep. The Arco, the river front and the two ends of the highway are level. Uphill your top speed falls by up to 16 % and gravity pulls you back, half as strongly as it pushes you downhill. Downhill your top speed rises by up to 22 % and you coast on. The truck feels slopes most, the motorcycle least. Brakes and rolling friction hold a stopped vehicle in place.

**Smooth picture.** If the game runs below 48 frames per second for 2 seconds, it lowers the resolution one step (85, 70, then 60 %). If that does not help, the step is taken back. After 20 seconds at 57 or more it goes back up, at most twice. The choice of Ultra or Balanced stays yours.

## Damage

| Rule | Value |
|---|---|
| Crash | impacts under 4 m/s (about 14 km/h) are free; above that, damage = (impact − 4) × 1.0 × the vehicle's damage factor. A wall at 122 km/h costs the car 30 %, the truck 17 %. One crash counts once: for 0.35 s after contact, only a harder hit costs more |
| 25 % damage | the paint shows dents (deepest at the nose and the tail), long scratches and dirt, and loses its shine as the damage grows; thin grey smoke rises from the engine |
| 50 % damage | warning: "Engine damaged: top speed reduced." Loose parts and a smashed light; the engine misfires; the smoke turns dark |
| 75 % damage | hood up (car), screen gone (motorcycle), hanging bumper and cracked windscreen (truck); a thick black column of smoke; sparks at speed |
| 88 % damage | the engine is on fire |
| **100 % damage** | **vehicle wrecked: game over** |
| Repair kit | removes 40 % damage, and the damage you see goes with it |

## Police

| Rule | Value |
|---|---|
| First police car | after 4 seconds; in the countryside once you are about 170 m along the road |
| **Wanted stars** | 1 to 5, shown under the clock. A new star every fifth of the time limit or of the way to the end (evidence in the city, distance on the open roads), whichever is further along. Each wrecked police car counts as 4 % more. Stars never fall. |
| New police car | until the number for your stars is reached, see the table below |
| Ramming | every hard hit lowers a police car's health by impact × your ramming power × 0.09; a police car is wrecked when its health is gone and comes back after the time in the table below |
| **Police wreck** | stays where it stopped: lights out, dented and dull, sagging to one side and smoking for about 14 s. Traffic stops behind it, and you and the police can crash into it. It is cleared when you are more than 260 m away, or after 30 s once you are more than 70 m away. When that car is sent back into the chase, it comes back clean |
| Far behind | a police car more than 140 m away drives 20 % faster; one more than 230 m away in the city, or 320 m on the open roads, is sent back near you with full health |
| Hills | police slow down uphill and speed up downhill as you do; other traffic keeps its speed |
| **Bust meter** | fills while a police car is **within 9 m** and you are **slower than 4.5 m/s** (about 16 km/h): full in 2.2 s. Otherwise it drains (empty from full in 3 s). |
| **Busted** | bust meter at 100 %: game over |

| Stars | Police cars | Police speed | New car every | Wrecked car returns after | Health |
|---|---|---|---|---|---|
| ★ | 1 | 100 % | 3 s | 9 s | 3 |
| ★★ | 2 | 100 % | 3 s | 9 s | 3 |
| ★★★ | 3 | 103 % | 3 s | 8 s | 3 |
| ★★★★ | 3 | 106 % | 2.5 s | 6 s | 3.5 |
| ★★★★★ | 4 | 110 % | 2 s | 4.5 s | 4 |

**Helicopter.** After 60 seconds on the run (or sooner with the fifth star), a police helicopter joins the chase for the rest of the run and hunts you with its searchlight. Its searchlight follows you at 94 % of the police speed. While you are in the light (within 9 m of its centre), the police drive 6 % faster, and in the city they see you from 170 m instead of 110 m. It cannot bust you or damage you. An undamaged car or motorcycle at full speed on a clear, level road stays ahead of the light; the truck, and a badly damaged car, cannot.

## Radio

Seven stations, or off: Reggae, Techno, Hardstyle, Schlager, Sing-Along Pop, Classical and Heavy Metal. Choose in the menu, or at any time with `R` or the radio button. The music plays while you drive, and is silent in the menu and in pause.

All of it is composed and synthesised by the game, with no music files. The tunes are generated by the game. The classical station plays Bach and Beethoven, whose works are in the public domain.

## Ending a run

| Result | When |
|---|---|
| **Clean getaway** | Lisbon: reach the gate under the arch, with the six pieces of evidence and the witness; the drive over the bridge follows. Highway: pass the 4 km mark. Countryside: reach the village |
| **Busted** | the bust meter is full |
| **Wrecked** | damage reaches 100 % |
| **Time's up** | the clock reaches 0:00 |

## Stars and best times

- **Drive time.** In the city this is the time used. On the highway and in the countryside it is the time used plus the bonus seconds the shards gave you, so collecting shards never makes a run look slower.
- **Stars:**

| Map | ★★★ | ★★ | ★ |
|---|---|---|---|
| City | more than 40 % of the time left | more than 20 % left | otherwise |
| Highway | under 88 s | under 105 s | otherwise |
| Countryside | under 115 s | under 135 s | otherwise |

- These limits are for the car. For the other vehicles the drive time counts multiplied by their speed factor (motorcycle 1.12, truck 0.78), so each can earn three stars.
- More than 50 % damage costs one star, but never the last one.
- The best drive time per map is saved in the browser. Saved values under 10 s or over 15 minutes are ignored, because no run can take that long or that little.

## Drivers and the leaderboard

- **Driver.** In the main menu (section 03) you create a driver by typing a name, or pick a saved one. A name keeps letters, digits, spaces and `. _ ' -`, up to 16 characters; capital letters do not matter, so *alex* and *Alex* are the same driver.
- **Leaderboard.** Every finished free ride (Lisbon, Highway, Countryside) goes on the board of its map under the active driver, with the drive time and the vehicle. Each driver has one entry per map, their best time; a slower run never replaces it. The fastest time is first, and on a tie the time that was there first stays ahead.
- **End screen.** After the finish the board of that map shows the top five, and the driver's own place below them if they are further down. It says whether the run is a new personal best and which place it has. Without a driver, the end screen asks for a name first; the time is saved as soon as the name is entered.
- Runs that end busted, wrecked or out of time, and the story mode, do not go on the board.
- The drivers and the boards are kept in this browser only. There is no password and nothing is sent anywhere, so the board shows the people who play on the same device.

## Story mode: The Necklace Job

| Act | Map | Goal | Special rule |
|---|---|---|---|
| **1 · The Evidence** | Lisbon | Recover the 6 pieces of evidence, pick up the witness, then the gate and the bridge | An optional **sealed letter** is hidden in a park. It is **not shown on the radar**. |
| **2 · The Courier** | Highway | Catch the gold-marked courier lorry (get within 9 m) to take the **clasp**, then the finish | The **toll at the finish only opens with the clasp**: without it you stop there |
| **3 · Homecoming** | Countryside | Drive back to the Ashford mansion | Officer Hale waits on the right verge 70 m before the finish and calls out when you are close. The confrontation decides the ending |

| Ending | When |
|---|---|
| **A · The truth** | You found the letter: it proves Lady Ashford staged the theft. Hale gives you your badge back. |
| **B · Back in 4471** | No letter: the evidence alone, brought by an escaped convict, is not believed. Lady Ashford hands you to the police, and you go back to cell 4471. |
| **C · Caught** | Busted, wrecked or out of time in any act: back to Cell Block D. You can retry that act. |

**Retrying an act:** a letter found during the failed attempt does **not** count. A letter found in an earlier, finished act does.

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

The last map and vehicle, the best times, the drivers and leaderboards, the radio station, the graphics, the steering and both volumes are saved in the browser. Every saved value is checked when loaded; invalid values fall back to Lisbon, Car, radio off and the defaults. All settings are explained in [Settings and options](settings.md).

## Controls

| Input | Action |
|---|---|
| `W A S D` or arrow keys | Drive |
| `Space` | Handbrake |
| `P` / `Esc` | Pause |
| `M` | Sound on or off |
| Volume sliders | In the menu and on the pause card: `Game` (engine, effects, sirens) and `Music` (the radio), 0 to 100 %. They are kept for the next visit |
| `R` | Next radio station (`Shift` + `R` for the one before) |
| `Enter` / `Space` | Press the button in focus. With no button in focus, `Enter` presses the card's main button. While driving, `Space` is the handbrake |
| `Tab` | Move between the buttons of a card |
| Touch pads | Steer on the left; brake and gas on the right. Both together are the handbrake |
| Tilt (phones) | Hold the phone sideways and lower one side, like a steering wheel: from 3° it starts to steer, at 24° it is at full lock. The steering buttons go away while tilt works. Upright, or if the sensor is refused or missing, the buttons stay. Choose `Tilt` or `Buttons` in the menu or on the pause card. The sensor is only read in the browser and nothing is stored or sent |
