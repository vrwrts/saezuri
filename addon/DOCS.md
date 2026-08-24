# Saezuri

A live bird collage for [BirdNET-Go](https://github.com/tphakala/birdnet-go), in the
kachō-e woodblock style of
[AvianVisitors](https://github.com/Twarner491/AvianVisitors). BirdNET-Go does the
listening; Saezuri shows what it heard, drawing the birds you hear most the largest.

Saezuri is read-only. It never writes to BirdNET-Go, and the browser only ever
talks to Saezuri itself.

## Installation

1. In Home Assistant, go to **Settings** → **Apps** → **App store**, open the
   three-dot menu and choose **Repositories**.
2. Add `https://github.com/vrwrts/saezuri`.
3. Find **Saezuri** in the store and click **Install**.
4. Start it. It appears in the sidebar as **Saezuri**.

If BirdNET-Go runs as an app on the same machine you can start Saezuri without
configuring anything. Otherwise set **BirdNET-Go URL** first.

## Finding BirdNET-Go

Leave **BirdNET-Go URL** empty and Saezuri looks for a BirdNET-Go app on the
Supervisor network at startup. It tries these hostnames on port 8080, in order, and
confirms each hit really is BirdNET-Go before using it:

| Hostname | Where that app came from |
| --- | --- |
| `db21ed7f-birdnet-go` | the [alexbelgium add-ons](https://github.com/alexbelgium/hassio-addons) repository |
| `local-birdnet-go` | a copy you built yourself under `/addons` |
| `a0d7b954-birdnet-go` | the [Home Assistant Community Add-ons](https://github.com/hassio-addons/repository) repository |

The app log says which one it picked. If several respond, the first in that order
wins and the others are logged so you can see what was skipped.

**If nothing is found**, the app stops with a message saying so. Set
**BirdNET-Go URL** to your instance, for example `http://192.168.1.10:8080`. That
also covers a BirdNET-Go that is not an app at all, running in Docker or on
another machine.

**If it picks the wrong instance**, set **BirdNET-Go URL** explicitly. A configured
URL always wins and is never second-guessed.

**If your BirdNET-Go app has an unusual slug**, put its hostname in **Extra hostnames to
probe** rather than waiting on a code change. Entries there are tried first.

**If the log says authentication is required**, your BirdNET-Go runs in PrivateMode.
Detection can find the instance but cannot discover a token, so set **BirdNET-Go
token** as well.

## Configuration

### Connection

| Option | What it does |
| --- | --- |
| **BirdNET-Go URL** | Base URL of your instance, for example `http://192.168.1.10:8080`. Leave empty for the detection above. |
| **BirdNET-Go token** | Bearer token. Only needed when BirdNET-Go runs in PrivateMode. |
| **Extra hostnames to probe** | Comma-separated hostnames tried before the built-in guesses during detection. |

### Illustrations

The moment BirdNET-Go reports a species, Saezuri downloads its ready-made cutout
from the [saezuri-illustrations](https://github.com/vrwrts/saezuri-illustrations)
repo. This is on by default and needs no key. Species with no contributed art get a
generic silhouette, still labelled and still sized by their real count.

| Option | Default | What it does |
| --- | --- | --- |
| **Illustrations repository** | `vrwrts/saezuri-illustrations` | Where cutouts are downloaded from. Empty turns downloading off. |
| **Illustrations branch** | `main` | Branch or tag to download from. |
| **Illustrations base URL** | derived | Overrides the two above with a direct URL. |
| **Gemini API key** | unset | Optional. Set it to *also* generate art, in the same style, for species nobody has contributed yet. |
| **Pause between generations** | `6` | Seconds between generated illustrations. Lower on a paid tier, raise if rate-limited. |
| **Species notes** | none | Per-bird prompt corrections, see below. |

Generation costs money at Google's rates and is entirely optional. Everything works
without a key.

Illustrations are generated one pose at a time, perched first. A bird stops being a
silhouette as soon as its perched illustration lands, so it appears without waiting
for the flight one.

### Species notes

Some birds come out wrong no matter how often they are regenerated — the model's idea
of them is simply off, and trying again won't help. A note is a short description
added to that bird's prompt only. One entry per bird:

```
Turdus merula|Solid glossy black, orange-yellow bill and eye-ring.
Parus major|Black crown and throat stripe, white cheeks, yellow underparts.
```

Use the scientific name before the pipe (the slug, like `turdus-merula`, also works).
Change a note and that bird is redrawn on the next cycle — nothing to restart.

Notes only affect illustrations this app generates itself. One downloaded from the
illustrations repository is left as it is, because that repository is the shared set
everyone draws from. If a note fixes a bird the repository gets wrong, please
[contribute it there](https://github.com/vrwrts/saezuri-illustrations) so every
installation benefits.

### Reference recordings

When a species is heard, Saezuri looks up a freely-licensed recording of its call and
caches it, so selecting a bird offers a play button.

| Option | Default | What it does |
| --- | --- | --- |
| **Recording archives** | `commons` | Comma-separated archives to search. Empty turns recordings off. |
| **Recordings per cycle** | `4` | How many to look up at a time. |

### E-ink frames

Saezuri renders the same collage to a flat PNG per time window, for an e-ink panel.

| Option | Default | What it does |
| --- | --- | --- |
| **E-ink frame width** | `800` | Width in pixels. 700 or less switches to portrait packing. |
| **E-ink frame height** | `480` | Height in pixels. |
| **E-ink frame background** | `#fcfcfb` | Background, as a six-digit hex colour. |
| **E-ink frame shadows** | on | Soft shadows under the birds. |
| **E-ink frames to render** | all five | Comma-separated, from `1h,12h,24h,7d,all`. |

See *Using an e-ink panel* below for how to reach them.

### Display languages

| Option | Default | What it does |
| --- | --- | --- |
| **Display languages** | all 16 | Comma-separated languages to publish species names for. The browser picks the closest match to its own language. |

Available: `cs,da,de,en,es,fi,fr,hu,it,lv,nb,nl,pl,pt,sk,sv`.

### Refresh cadence

Rarely worth touching.

| Option | Default | What it does |
| --- | --- | --- |
| **Publish debounce** | `20000` ms | How long to wait after a detection before republishing, so a burst becomes one update. |
| **Ageing interval** | `120000` ms | How often detections are dropped out of their time window. |
| **Summary interval** | `1800000` ms | How often to recount everything from BirdNET-Go. |

## Using an e-ink panel

An e-ink panel fetches a rendered frame such as `/24h.png` directly. Ingress cannot
serve it, because ingress requires Home Assistant authentication and a panel has no
way to log in. So open the direct port instead:

1. Open the app's **Configuration** tab and switch to **Network**.
2. Give **8080/tcp** a host port, for example `8090`.
3. Restart the app.

Your panel then fetches `http://<home-assistant-host>:8090/24h.png`. That port serves
the whole collage with no authentication, so only open it on a network you trust.

The direct port used to be **80/tcp** and is now **8080/tcp**. The Supervisor stores the
mapping against the old number, so updating from 0.14.1 or earlier closes it: if you run a
panel, re-open it with the steps above once after updating.

## Storage

Downloaded illustrations, cached recordings and the working cache live in the app's
`/data`, which the Supervisor keeps across restarts and updates. They are included in
a Home Assistant backup, so a large illustration set makes for larger backups.

## Licensing

The illustrations and the tooling that makes them inherit **CC-BY-NC-SA-4.0** from the
BirdNET-Pi lineage, so this app and the art it downloads are **for non-commercial
use only**. Personal use in your own home is fine. Publishing the images, or a
repository derived from them, carries obligations worth reading first: see
[Credits and licensing](https://github.com/vrwrts/saezuri#credits-and-licensing).

Cached reference recordings each carry their own CC licence and are always shown with
their recordist credited.

## Support

Issues and questions: <https://github.com/vrwrts/saezuri/issues>.
