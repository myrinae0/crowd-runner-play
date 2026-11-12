# Credits

The pixel art uses two packs by Kenney, all released under CC0 1.0 (public
domain): https://creativecommons.org/publicdomain/zero/1.0/

| Pack | Author | Source | License | Used for |
|---|---|---|---|---|
| Tiny Town | Kenney (www.kenney.nl) | https://kenney.nl/assets/tiny-town | CC0 1.0 | Grass and dirt-road floor tiles, trees, mushrooms, the houses (roof, gable and wall tiles composed into one image each), fences and the well (`assets/pixel/tiny-town.png`) |
| Tiny Battle | Kenney (www.kenney.nl) | https://kenney.nl/assets/tiny-battle | CC0 1.0 | Water floor and pond tile, flags, small grove trees, the palette the soldiers are drawn in (`assets/pixel/tiny-battle.png`) |

The files in `assets/pixel/` are the packs' unmodified `Tilemap/tilemap_packed.png`
sheets (16 x 16 tiles, no spacing).

Everything else is drawn in code (`src/pixel/`): the soldiers (the player's
crowd seen from behind, enemies from the front, in Kenney's palette), the boss,
saws, boulders, coins, pickups, smaller far-away trees, the mid and far
sizes of the houses, fences and well, barrels, crates, hay bales, pumpkins,
rocks, the flat field patches (ponds, dirt, flower beds, crops, leaves; the
pond water and dirt reuse the Kenney tiles above), the windmill, watchtower and
castle landmarks, the sky, gates, the bitmap fonts and the HUD, all in Kenney's
palette. No art from commercial games.
