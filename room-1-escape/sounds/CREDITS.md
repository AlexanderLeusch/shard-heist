# Recorded sounds of the washroom

Real recordings, all in the public domain under **CC0 1.0** (https://creativecommons.org/publicdomain/zero/1.0/).
CC0 asks for no credit; we give it anyway. When the Openverse sound API answers (see `findApiVent` in `js/room.js`), the air vent plays a CC0 recording from Freesound instead of `air-vent.mp3`; the pause card names that recording and its creator. Everything else the room plays (the tube's hum, the drips, the effects) is
synthesised by `js/room.js` at run time.

| File | What it is | Source | Licence |
|---|---|---|---|
| `tap-water.mp3` | A tap turned on, running into a sink, and turned off again | *tap-water-1* from Owlish Media's *Sound Effects Pack* (OpenGameArt, https://opengameart.org/content/sound-effects-pack), as mirrored in the CC0 collection https://github.com/EternityForest/Free-SFX (`Owlish/Sound Effects Pack/Water/tap-water-1.opus`) | CC0 1.0 |
| `steps/floor-1.mp3` … `floor-4.mp3` | Single steps of a soft-soled shoe on a hard floor | *step1* … *step4* from Owlish Media's *Sound Effects Pack* (OpenGameArt, https://opengameart.org/content/sound-effects-pack), as mirrored in https://github.com/EternityForest/Free-SFX (`Owlish/Sound Effects Pack/Footsteps/`) | CC0 1.0 |
| `steps/wet-1.mp3` … `wet-3.mp3` | Steps into shallow water, for the puddles | *sfx100v2_footstep_wet_01* … *03* from rubberduck's *100 CC0 SFX #2* (OpenGameArt), as mirrored in https://github.com/EternityForest/Free-SFX (`rubberduck/SFX100V2/`) | CC0 1.0 |
| `steps/rung-1.mp3` … `rung-5.mp3` | A boot on wood, for the ladder's rungs | *footstep_wood_000* … *004* from Kenney's *Impact Sounds* 1.0 (https://kenney.nl/assets/impact-sounds), as vendored in https://github.com/OmniTender-Systems/game-audio-assets (`vendor/kenney/impact-sounds/`) | CC0 1.0 |
| `air-vent.mp3` | The steady rush of a fan, used for the air vent in the ceiling | *Fan* by lllBabaBooeylll, Freesound 536942 (https://freesound.org/people/lllBabaBooeylll/sounds/536942/), as trimmed in https://github.com/Tafazzolian/still-sounds (`files/noise-fan.ogg`) | CC0 1.0 |

## What was changed

- **tap-water.mp3**: the quiet gap between the handle and the water was cut, the handle made 6 dB quieter, and the
  steady stream between 1.08 s and 8.28 s crossfaded (1 s, equal power) so that it loops without a seam. After 8.28 s
  comes the rest of the recording: the water stops and the handle is shut. `room.js` plays the start once, loops the
  stream while the tap is on, and plays the end when it is turned off.
- **air-vent.mp3**: 9 s of the steady part, crossfaded (1.5 s) to loop between 0.25 s and 9.25 s, with a quarter
  second of the recording on either side so that an MP3 decoder's padding never falls inside the loop.
- **steps/**: each cut to start 5 ms before the footfall (so it sounds when the head dips), faded out at its end, and
  levelled to the same peak. `room.js` adds the washroom's echo, a little pitch and loudness variation, and pans left and
  right foot apart.
- tap and vent: mono, 44.1 kHz, levelled to about −20 dBFS, saved as 96 kbit/s MP3 (plays in every browser).
