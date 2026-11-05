# Room 2 · Shard Heist

> This document describes the rules in `src/core.js`, and the pickups and police in `src/game.js`.

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
| **Lisbon · Baixa** | Collect **all 8 shards**, then drive through the golden gate that appears under the Arco da Rua Augusta | 3:00 | 122 km/h | 119 km/h | 8 | 3 |
| **Highway** | Reach the finish **4 km** ahead. Shards are optional: **+4 s** each | 1:50 | 200 km/h | 187 km/h | 12 | 2 |
| **Countryside** | Reach the village at the end of the road. Shards: **+4 s** each | 2:30 | 158 km/h | 148 km/h | 10 | 3 |

- A shard is picked up within 3.8 m; a repair kit within 3.6 m, and only when you have damage.
- Lisbon has traffic lights, other cars and three yellow trams. The trams only run on their tracks, a stone track bed with two rails set into the road: a clockwise loop through Rua da Conceição, Rua da Prata, the north side of the Praça do Comércio and Rua Áurea. As on real Lisbon streets, cars and the player can drive over the tracks. The trams stop at red lights and behind other vehicles. On the highway traffic drives both ways. On country roads there is oncoming traffic, and driving off the road cuts your top speed to 55 %.
- Each map has an edge you cannot cross. When you near it the screen turns red and a "turn back" arrow appears. In Lisbon the outer streets are part of the map, so there this only happens when you head for the edge.

## The city map: Lisbon's Baixa

The Baixa is the centre of Lisbon, rebuilt as a street grid after the 1755 earthquake. The map is a simplified version of it: the blocks are square, and the grid has 7 streets each way. The real Baixa has a few more, so some are left out. The real Baixa is also flat; the hills on this map are a game decision.

| Direction | Streets, in their real order |
|---|---|
| West to east | Rua do Crucifixo, Rua Áurea, Rua dos Sapateiros, **Rua Augusta**, Rua dos Correeiros, Rua da Prata, Rua dos Fanqueiros |
| North to south | Rua de Santa Justa, Rua da Vitória, Rua de São Nicolau, Rua da Conceição, Rua do Comércio, Praça do Comércio (north side), Avenida Infante Dom Henrique |

- In free ride, the panel at the top left shows the street or square you are on. In story mode it shows the act instead.
- You start on Rua Augusta, facing south towards the Arco da Rua Augusta.
- **Squares:** the Rossio and the Praça da Figueira in the north, the Praça do Comércio by the river in the south. The statue on the Praça do Comércio stands in the middle of the road, so traffic passes on both sides.
- **Landmarks you can see but not reach:** the river Tejo, the 25 de Abril bridge, Cristo Rei and the castle hill. The Santa Justa lift stands on the map, and you can crash into it.
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
| Brake lights | on while you brake, in either direction, and with the handbrake while moving |
| Reversing lights | white, on while you roll backwards |
| Skid marks and tyre squeal | with the handbrake above about 15 km/h, when braking above about 30 km/h, and in very fast corners (above about 80 km/h, steering hard). They only mark the road, and they are cleared when a new run starts |

**Hills.** All three maps have hills, up to about 20 % steep. The Arco, the river front and the two ends of the highway are level. Uphill your top speed falls by up to 32 % and gravity pulls you back. Downhill your top speed rises by up to 22 % and you coast on. The truck feels slopes most, the motorcycle least. Brakes and rolling friction hold a stopped vehicle in place.

## Damage

| Rule | Value |
|---|---|
| Crash | impacts under 3 m/s (about 11 km/h) are free; above that, damage = (impact − 3) × 1.6 × the vehicle's damage factor |
| 25 % damage | the paint shows dents and scratches, and thin grey smoke rises from the engine |
| 50 % damage | warning: "Engine damaged: top speed reduced." Loose parts and a smashed light; the engine misfires; the smoke turns dark |
| 75 % damage | hood up (car), screen gone (motorcycle), hanging bumper and cracked windscreen (truck); a thick black column of smoke; sparks at speed |
| 88 % damage | the engine is on fire |
| **100 % damage** | **vehicle wrecked: game over** |
| Repair kit | removes 40 % damage, and the damage you see goes with it |

## Police

| Rule | Value |
|---|---|
| First police car | after 4 seconds; in the countryside once you are about 170 m along the road |
| **Wanted stars** | 1 to 5, shown under the clock. A new star every fifth of the time limit or of the way to the end (shards in the city, distance on the open roads), whichever is further along. Each wrecked police car counts as 4 % more. Stars never fall. |
| New police car | until the number for your stars is reached, see the table below |
| Ramming | every hard hit lowers a police car's health by impact × your ramming power × 0.09; a police car is wrecked when its health is gone and comes back after the time in the table below |
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
| **Clean getaway** | Lisbon: reach the gate under the arch. Highway: pass the 4 km mark. Countryside: reach the village |
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

## Story mode: The Necklace Job

| Act | Map | Goal | Special rule |
|---|---|---|---|
| **1 · The Scatter** | Lisbon | Recover the 8 shards, then the gate | An optional **sealed letter** is hidden in a park. It is **not shown on the radar**. |
| **2 · The Courier** | Highway | Catch the gold-marked courier lorry (get within 9 m) to take the **clasp**, then the finish | The **toll at the finish only opens with the clasp**: without it you stop there |
| **3 · Homecoming** | Countryside | Drive back to the Ashford mansion | The confrontation decides the ending |

| Ending | When |
|---|---|
| **A · The truth** | You found the letter: it proves Lady Ashford staged the theft. Hale gives you your badge back. |
| **B · Back in 4471** | No letter: Lady Ashford hands you to the police, and you go back to cell 4471. |
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

The last map and vehicle, the best times, the radio station and the graphics setting are saved in the browser. Every saved value is checked when loaded; invalid values fall back to Lisbon, Car, radio off and the defaults.

## Controls

| Input | Action |
|---|---|
| `W A S D` or arrow keys | Drive |
| `Space` | Handbrake |
| `P` / `Esc` | Pause |
| `M` | Sound on or off |
| `R` | Next radio station (`Shift` + `R` for the one before) |
| `Enter` / `Space` | Press the button in focus. With no button in focus, `Enter` presses the card's main button. While driving, `Space` is the handbrake |
| `Tab` | Move between the buttons of a card |
| Touch pads | Steer on the left; brake and gas on the right |
