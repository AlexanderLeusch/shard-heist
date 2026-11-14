# Recorded sounds of the washroom

Two real recordings, both in the public domain under **CC0 1.0** (https://creativecommons.org/publicdomain/zero/1.0/).
CC0 asks for no credit; we give it anyway. When the Openverse sound API answers (see `findApiVent` in `js/room.js`), the air vent plays a CC0 recording from Freesound instead of `air-vent.mp3`; the pause card names that recording and its creator. Everything else the room plays (the tube's hum, the drips, the effects) is
synthesised by `js/room.js` at run time.

| File | What it is | Source | Licence |
|---|---|---|---|
| `tap-water.mp3` | A tap turned on, running into a sink, and turned off again | *tap-water-1* from Owlish Media's *Sound Effects Pack* (OpenGameArt, https://opengameart.org/content/sound-effects-pack), as mirrored in the CC0 collection https://github.com/EternityForest/Free-SFX (`Owlish/Sound Effects Pack/Water/tap-water-1.opus`) | CC0 1.0 |
| `air-vent.mp3` | The steady rush of a fan, used for the air vent in the ceiling | *Fan* by lllBabaBooeylll, Freesound 536942 (https://freesound.org/people/lllBabaBooeylll/sounds/536942/), as trimmed in https://github.com/Tafazzolian/still-sounds (`files/noise-fan.ogg`) | CC0 1.0 |

## What was changed

- **tap-water.mp3**: the quiet gap between the handle and the water was cut, the handle made 6 dB quieter, and the
  steady stream between 1.08 s and 8.28 s crossfaded (1 s, equal power) so that it loops without a seam. After 8.28 s
  comes the rest of the recording: the water stops and the handle is shut. `room.js` plays the start once, loops the
  stream while the tap is on, and plays the end when it is turned off.
- **air-vent.mp3**: 9 s of the steady part, crossfaded (1.5 s) to loop between 0.25 s and 9.25 s, with a quarter
  second of the recording on either side so that an MP3 decoder's padding never falls inside the loop.
- Both: mono, 44.1 kHz, levelled to about −20 dBFS, saved as 96 kbit/s MP3 (plays in every browser).
