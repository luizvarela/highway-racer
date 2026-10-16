# Tripo prompts for Neon Getaway car models

Goal: replace the Kenney Car Kit vehicles with more detailed, original models,
all in one consistent style. Rules: original designs only. No real brands,
logos, badges or licence plates, and no designs that look like a real model.

## Workflow

1. **Test car first:** make the Comet only, then stop for a review.
2. In Tripo, use **Image to 3D** with a concept image. It gives the most
   control. If you'd rather skip the image step, use **Text to 3D** with the
   short prompt under each car.
3. Concept image: make it with any image tool (ChatGPT, Gemini, Midjourney)
   from the "Image prompt" below. Pick a result that is a **3/4 front view,
   whole car in frame, plain background, no driver, no text**.
4. Tripo settings (if offered): textures **on**, PBR **on**, highest texture
   quality, no style preset. Leave the face limit high; the import step
   reduces it.
5. Export **GLB** and save it as `assets-src/tripo/<id>.glb` (e.g.
   `assets-src/tripo/comet.glb`). The import step cleans it up and writes the
   game-ready file to `public/models/`.
6. Before saving, check: no logo or lettering, four round wheels, no
   passengers, and it doesn't look like a real car brand.

You don't need to fix wheels or lights. The game replaces the wheels with its
own spinning ones and adds the glowing head/tail lights and police light bars
in code.

## Shared style (paste into every image prompt)

> Stylized realistic video game car, clean smooth body panels, bold readable
> silhouette, slightly exaggerated proportions, glossy car paint, dark tinted
> windows, simple dark headlight and taillight shapes, black rims, original
> fictional design, no logos, no badges, no text, no licence plate, no driver,
> single vehicle centered, three-quarter front view, plain light grey studio
> background, soft even lighting, no shadows on background

Negative prompt (if the tool has a field for it):

> logo, emblem, badge, text, letters, licence plate, brand, person, driver,
> passengers, motion blur, background scenery, road, multiple cars, cropped,
> cartoon toy, low detail, damaged, dirty

---

## Player cars

### 1. Comet (starter, `comet`): street sedan, glow cyan
Image prompt:
> Compact sporty four-door street sedan, tidy and modest but with a low stance,
> short trunk lip spoiler, slim angular headlights, deep metallic blue paint.
> [shared style]

Text to 3D:
> Stylized sporty four-door sedan, metallic blue, low stance, small trunk
> spoiler, tinted windows, clean game asset, no logos, no plate

### 2. Viper ($3,000, `viper`): light hot hatch, glow magenta
Image prompt:
> Small aggressive three-door hot hatchback, short wheelbase, wide fender
> flares, roof spoiler, big front air intakes, compact and nimble looking,
> pearl white paint with a single thin magenta stripe along the side.
> [shared style]

Text to 3D:
> Stylized small hot hatchback, pearl white with thin magenta side stripe,
> wide fenders, roof spoiler, clean game asset, no logos, no plate

### 3. Bruiser ($6,500, `bruiser`): heavy luxury SUV, glow orange
Image prompt:
> Large muscular luxury SUV, tall and wide, boxy confident shape, big square
> grille shape without any emblem, chunky bumpers, roof rails, large wheels,
> gloss black paint with dark chrome trim. [shared style]

Text to 3D:
> Stylized large luxury SUV, gloss black, boxy and muscular, big plain grille,
> roof rails, large wheels, clean game asset, no logos, no plate

### 4. Phantom ($15,000, `phantom`): prototype racer, glow lime
Image prompt:
> Futuristic low two-seat prototype hypercar, very low and wide, cab-forward
> canopy, sharp wedge nose, large rear wing, side air intakes, aerodynamic
> fins, matte graphite paint with lime green accent lines. [shared style]

Text to 3D:
> Stylized futuristic prototype hypercar, matte graphite with lime accents,
> very low and wide, big rear wing, wedge nose, clean game asset, no logos

## Police

### 5. Patrol car (`police`)
Image prompt:
> Fictional police interceptor sedan, muscular four-door, push bar on the
> front bumper, black body with white doors, flat roof with an empty mount for
> a light bar (no lights, no lettering). [shared style]

Text to 3D:
> Stylized police interceptor sedan, black with white doors, front push bar,
> no light bar, no lettering, clean game asset, no logos, no plate

### 6. Police SUV (`police-suv`, optional, for higher wanted levels)
Image prompt:
> Fictional police pursuit SUV, tall and heavy, front push bar, black body
> with white doors, roof rack mount for a light bar (no lights, no lettering).
> [shared style]

## Traffic (after the player cars are approved)

Same shared style, but plain everyday colours, so traffic doesn't compete
with the player car:

| id | Image prompt start |
|---|---|
| `sedan` | Ordinary family four-door sedan, silver paint |
| `hatchback` | Ordinary small five-door city hatchback, red paint |
| `suv` | Ordinary mid-size family SUV, dark green paint |
| `taxi` | Fictional city taxi sedan, yellow paint, roof sign shape with no text |
| `van` | Boxy delivery minivan, white paint, plain sides |
| `truck` | Medium box truck with a plain white cargo box, cab-over front |
| `bus` | City bus, plain white and blue paint, no text or route sign |

## What I need back for the test

- `assets-src/tripo/comet.glb`
- the concept image you used (any format), saved next to it as
  `assets-src/tripo/comet.png`, in case we need to regenerate
