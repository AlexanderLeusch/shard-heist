# Settings and options

> Every setting the player can change, in both rooms: where it is, what each choice does, and what the game remembers. All of it is stored only in this browser (`localStorage`). Nothing is sent anywhere. The only “account” is a driver name for the leaderboard, with no password, kept on this device.

## Room 2 · Shard Heist: the main menu

| Setting | Choices | What it does |
|---|---|---|
| **Map** | Lisbon (Baixa), Highway, Country Roads | Where the run takes place. Each map has its own goal, time limit and top speed (see *Maps* in the room 2 rules) |
| **Vehicle** | Car, Motorcycle, Truck | Speed, acceleration, handling, how much damage a crash does and how the police can push you. The card under the choice shows the numbers |
| **Mode** | Start the getaway (free ride), or the story card *The Necklace Job* | Free ride is one run on the chosen map. The story plays all three maps in order, with Hale on the radio and three endings |
| **Radio** | Off, Reggae, Techno, Hardstyle, Schlager, Sing-Along Pop, Classical, Heavy Metal | The station that plays while you drive. `R` changes it at any time, `Shift` + `R` goes back one |
| **Graphics** | Ultra, Balanced | **Ultra:** sharper picture (up to twice the screen resolution), smoothed edges, glowing lights and the finest shadows (4096 × 4096). **Balanced:** a lighter picture without the glow and with smaller shadows (2048 × 2048). Computers start in Ultra, phones in Balanced |
| **Steering** (phones only) | Tilt, Buttons | **Tilt:** hold the phone sideways and lower one side like a steering wheel. **Buttons:** steer with the arrow pads. Tilt is the default on a phone with a motion sensor |
| **Driver** | The saved drivers, and a field for a new name | Creates a driver (just a name, up to 16 letters, digits, spaces and `. _ ' -`) or picks a saved one. Each finished free ride goes on the leaderboard of its map under the active driver. Names are matched without case, so *alex* and *Alex* are the same driver. Up to 12 drivers are kept; adding a 13th drops the oldest from the list (its times stay on the boards) |
| **Volume** | `Game` 0–100 %, `Music` 0–100 % | `Game` is the engine, tyres, sirens, the helicopter and all effects. `Music` is the radio. The music plays for a moment while its slider moves, so it can be heard; letting go of the game slider plays a short tone |

## Room 2: during a run

| Setting | How | What it does |
|---|---|---|
| **Pause** | `P`, `Esc` or the pause button | Stops everything: the clock, the police, the traffic and the music. The pause card shows the shards, time, damage and bust meter |
| **Pause card** | Resume, Restart (or Retry act in the story), Main menu | It also has the steering choice (phones) and both volume sliders |
| **Sound** | `M` or the speaker button | Turns all sound off or on, without changing the volume sliders |
| **Radio** | `R` or the radio button | Next station; the name is shown under the clock |

## Room 2: what the game sets by itself

| Setting | Rule |
|---|---|
| **Resolution** | If the game runs below 48 frames per second for 2 seconds, the resolution drops one step: 85 %, then 70 %, then 60 %. A step that does not make the game faster by at least 5 % is taken back and the setting stays. After 20 seconds at 57 frames per second or more it goes one step back up, at most twice. Choosing Ultra or Balanced starts again at full resolution |
| **Shadows** | The area that gets shadows (120 m wide) follows the player in whole shadow pixels, so shadow edges do not crawl over the walls |
| **Phones** | Phones start in Balanced and use shadows of half the size |
| **Less motion** | If the system asks for reduced motion, the camera and the vehicle do not shake after crashes or on the tram rails, the radar sweep stops and the menu turns more slowly |
| **Vibration** | On a phone whose browser can vibrate (most Android phones; iPhones cannot), each tram rail under a wheel gives a short buzz of 12–30 ms, at most one every 0.09 s |
| **Hidden tab** | When the tab is hidden or the window loses focus, the run pauses and the sound stops |

## Room 1 · Plot Twist: Cell Block D

| Setting | How | What it does |
|---|---|---|
| **Continue or New game** | Shown after a reload, if there is a saved game | Continue goes on where you were, with the time that was left. New game asks first, then deletes the save |
| **Pause** | `P`, `Esc` or the pause button | Stops the clock. The pause card has Resume, Restart and the volume slider |
| **Volume** | Slider on the pause card, 0–100 % | All sounds of the washroom: the light's hum, dripping water, the tap and the effects. A short tone plays when it is let go |
| **Sound** | `M` or the speaker button | All sound off or on |
| **Look around** | Drag, or the arrow keys | Turns the view in the current scene |

## What is remembered, and what happens to bad values

Every stored value comes from outside the program, so each one is checked when it is loaded. A value that is missing or wrong is ignored and the default is used; the game never breaks because of it.

| Stored | Room | Default if missing or invalid |
|---|---|---|
| Map and vehicle | 2 | Lisbon and the car |
| Best time per map | 2 | No best time (only 10 s to 900 s counts) |
| Drivers and leaderboard | 2 | Empty board; names are cleaned again, impossible times and unknown maps are dropped, and only each driver's best run per map is kept |
| Active driver | 2 | No driver: the end screen asks for a name |
| Radio station | 2 | Off |
| Graphics | 2 | Ultra on a computer, Balanced on a phone |
| Steering | 2 | Tilt |
| Game and music volume | 2 | 100 % each; a value outside 0–100 % is cut to the range |
| Saved game | 1 | No saved game; any save that no real game could produce is refused |
| Volume | 1 | 100 % |

To reset everything, clear this site's data in the browser settings.
