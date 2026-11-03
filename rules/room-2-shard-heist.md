# Room 2 · Shard Heist

> Working draft. It describes the current code: the rules in `src/core.js`, and pickups and police in `src/game.js`.

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
| **City traffic** | Collect **all 8 shards**, then drive into the golden gate that appears | 3:00 | 122 km/h | 119 km/h | 8 | 3 |
| **Highway** | Reach the finish **4 km** ahead. Shards are optional: **+4 s** each | 1:40 | 200 km/h | 187 km/h | 12 | 2 |
| **Countryside** | Reach the village at the end of the road. Shards: **+4 s** each | 2:30 | 158 km/h | 148 km/h | 10 | 3 |

- A shard is picked up within 3.8 m; a repair kit within 3.6 m, and only when you have damage.
- The city has traffic lights and other cars. On the highway traffic drives both ways. On country roads there is oncoming traffic, and driving off the road cuts your top speed to 55 %.
- Each map has an edge you cannot cross. Near it the screen turns red and a "turn back" arrow appears.

## Driving

| Rule | Value |
|---|---|
| Top speed | map top speed × vehicle speed, **minus up to 40 %** at 100 % damage |
| Throttle | never pushes you above the top speed |
| Brake | slows you down, then reverses, up to 40 km/h backwards |
| No pedal | the car rolls to a stop |
| Handbrake (`Space`) | slows you quickly and turns sharper |

## Damage

| Rule | Value |
|---|---|
| Crash | impacts under 3 m/s (about 11 km/h) are free; above that, damage = (impact − 3) × 1.6 × the vehicle's damage factor |
| 50 % damage | warning: "Engine damaged: top speed reduced." |
| **100 % damage** | **vehicle wrecked: game over** |
| Repair kit | removes 40 % damage |

## Police

| Rule | Value |
|---|---|
| First police car | after 4 seconds |
| How many chase you (heat) | City: 1, then 2 after 3 shards, then 3 after 6 shards. Highway and countryside: 1, then 2 after 1.2 km, then 3 after 2.5 km |
| New police car | every 3 seconds until the heat level is reached |
| Ramming | every hard hit lowers a police car's health by impact × your ramming power; a police car is wrecked after 3 health points and comes back after 9 seconds |
| **Bust meter** | fills while a police car is **within 9 m** and you are **slower than 4.5 m/s** (about 16 km/h): full in 2.2 s. Otherwise it drains (empty from full in 3 s). |
| **Busted** | bust meter at 100 %: game over |

## Ending a run

| Result | When |
|---|---|
| **Clean getaway** | City: reach the gate. Highway: pass the 4 km mark. Countryside: reach the village |
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

- More than 50 % damage costs one star, but never the last one.
- The best drive time per map is saved in the browser. Implausible saved values are ignored.

## Story mode: The Necklace Job

| Act | Map | Goal | Special rule |
|---|---|---|---|
| **1 · The Scatter** | City | Recover the 8 shards, then the gate | An optional **sealed letter** is hidden in a park. It is **not shown on the radar**. |
| **2 · The Courier** | Highway | Catch the gold-marked courier lorry (get within 9 m) to take the **clasp**, then the finish | The **toll at the finish only opens with the clasp** |
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
| Drive again / Restart | after a run, or in the pause menu |
| Resume | in the pause menu |
| Main menu | anywhere except while driving |
| Next act | after a finished act, but not after the last one |
| Retry act | after Ending C, or in the pause menu during a story |

Any other button or action is refused, and no card button works while you are driving.

## Saved settings

The last map and vehicle, the best times and the graphics setting are saved in the browser. Every saved value is checked when loaded; invalid values fall back to City, Car and the defaults.

## Controls

| Input | Action |
|---|---|
| `W A S D` or arrow keys | Drive |
| `Space` | Handbrake |
| `P` / `Esc` | Pause |
| `M` | Sound on or off |
| `Enter` | Confirm the main button on a card |
| Touch pads | Steer on the left; brake and gas on the right |
