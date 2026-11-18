// Tuning for the bird-name placement engine. The approach and starting values come
// from studying AvianVisitors' collage labels; the reasoning for each is kept here,
// once, so the modules that use them stay quiet.

/** Caveat's inked em band: ascenders reach this far above the baseline… */
export const ASC_EM = 0.8
/** …and descenders this far below it. */
export const DESC_EM = 0.25

/** Largest type any bird gets, so no name shouts louder than another. */
export const MAX_PX = 21
/** Type size as a share of the side of the tile's equal-area square. Keyed on area
 *  rather than width so a tall, narrow heron isn't refused readable type. */
export const CAP_FRAC = 0.16
/** How far below the cap the type may shrink while still hunting for an edge. Past
 *  this, a level supporting line at full size reads better than a contour at half. */
export const SHRINK_STEPS_PX = 4

/** Paper the eye reads between a silhouette and its letters. */
export const NEAR_PX = 2
/** Paper the packer keeps clear around the lettering, separate from NEAR_PX so
 *  bringing a name closer to its bird doesn't also let neighbours closer to it. */
export const GAP_PX = 3

/** Most ink a single letter-width of a name may sit on. Not zero only because an
 *  equality on a float sum is not a tolerance: one claw through one letter refuses
 *  the placement, and there is always a cleaner place further down the search. */
export const MAX_INK = 0.0025
/** Width of the ink test's sliding window, in em: about one letter. */
export const LETTER_EM = 0.45

/** Lean, in degrees, at which a letter stops reading as upright. Also the sharpest
 *  turn allowed between consecutive letters, so a word never chevrons. */
export const MAX_LEAN_DEG = 55
/** What a letter at MAX_LEAN_DEG is still worth against an upright one. A cost, not
 *  a cliff: a bird's steep back should be able to beat a flat stub off its crown. */
export const LEAN_WORTH = 0.5
/** Farthest a run may bow off its own chord, as a share of the chord. */
export const MAX_BOW = 0.06
/** What a run bowed all the way to MAX_BOW is worth against a straight one. */
export const BOW_WORTH = 0.5
/** Chord over arc below which a run reads as a curve rather than a line… */
export const CURVED_STRAIGHTNESS = 0.85
/** …and above which it reads as a dead-straight line. */
export const STRAIGHT_STRAIGHTNESS = 0.97
/** A run whose ends face each other has wrapped round the bird and is no longer
 *  one edge; nothing longer from the same start can be either. */
export const WRAPPED_STRAIGHTNESS = 0.5
/** Longest run scanned, as a share of the outline. */
export const MAX_RUN_SHARE = 0.62
/** Fewest outline samples that have a shape at all. */
export const MIN_RUN_SAMPLES = 3

/** How far past each end of its run the lettering may carry, in em. Type is sized
 *  from the tile, not the run, so a short edge only has to point the way; the name
 *  carries on past the bird along the line the edge set. */
export const OVERRUN_EM = 3
/** Shortest run worth writing along, in em. Below this the tangent fallback does
 *  the same job better. */
export const MIN_RUN_EM = 1.25
/** One best run is kept per stretch of outline this long (share of the outline),
 *  so the shortlist holds genuinely different edges, not shuffles of one. */
export const RUN_SLOT_SHARE = 0.025
/** Runs kept on the shortlist. Deep enough that a bird with busy feet still has
 *  somewhere to go once its best runs are refused. */
export const SHORTLIST = 16
/** A run must have at least this share of the bird's deepest run beneath it. A
 *  hummingbird's bill is its flattest, longest edge, but nothing is under it, so a
 *  name there hangs over the drawing like a caption. Relative to the bird's own
 *  best so a heron, thin everywhere, keeps every run it has. */
export const SEAT_SHARE = 0.35

/** Share of the run's supported stretch that must have bird beside it. */
export const ADHERE_SHARE = 0.9
/** Reach, in em, at which the edge test looks for bird beside the lettering. */
export const ADHERE_REACH_EM = 1.3
/** Fixed reach, in em, for scoring a finished label, so a name pushed further out
 *  is charged for the distance rather than judged on its own terms. */
export const BESIDE_REACH_EM = 2
/** Extra clearance tried, in em, when a placement lands on ink. Fine steps first,
 *  since most refusals are a graze and a coarse first step throws away NEAR_PX. */
export const LIFT_LADDER_EM = [0, 0.02, 0.06, 0.18, 0.45] as const

/** What a run that can't hold the whole name is still worth, against one that can. */
export const PARTIAL_HOLD = 0.4
/** Power on attachment in a placement's merit. Counted once, a name two thirds
 *  beside its bird and one wholly beside it differ by less than a few degrees of
 *  tilt; raised to this power, attachment decides. */
export const ATTACH_POWER = 4
/** A placement at least this attached… */
export const SNUG_ATTACH = 0.85
/** …and reserving no more than this share of a tile in fresh paper is taken as it
 *  stands, without weighing other runs or a broken name. */
export const SNUG_PAPER = 0.25

/** Leading between the lines of a broken name, in em: exactly the inked band, so
 *  the lower line's ascenders meet the upper line's descenders. */
export const LEADING_EM = 1.05
/** A break is refused if the shorter line is less than this share of the longer:
 *  a long line over a stub reads as a line that ran out of room. */
export const EVEN_BREAK = 0.4
/** What a broken name must beat one line by; its second line sits further off. */
export const BREAK_WORTH = 0.94

/** Share of its name a bird's edge must carry before its overrun stays straight;
 *  below this, the name follows the bird round instead. */
export const CURL_LEDGE = 0.36
/** Steepest lean a curled name may reach. Past MAX_LEAN_DEG on purpose: these birds'
 *  backs are steeper than a letter may stand, and hugging them beats leaving them. */
export const CURL_MAX_DEG = 68

/** Steepest a supporting tangent line may be drawn, and its angular step. The bird
 *  didn't draw that line, so nothing justifies a rake: it should read near level. */
export const TANGENT_MAX_DEG = 30
export const TANGENT_STEP_DEG = 5
/** Longest a name on a tangent line may be, as a multiple of the tile width. A
 *  tangent has no run to bound its overrun, so this keeps a long name on a small
 *  bird from reserving a tile of open paper at each end. */
export const TANGENT_REACH = 1.15

/** Baseline sample spacing in px, about one letter at these sizes. */
export const BASELINE_STEP_PX = 6
/** Smoothing passes over each finished baseline (see smoothBaseline). */
export const BASELINE_SMOOTH_PASSES = 3
/** Extra px on each baseline. A textPath even a fraction of a pixel shorter than
 *  its string silently drops the last glyph. */
export const BASELINE_SLACK_PX = 4
/** Baseline points per packer sub-box. Fewer hugs a curve closer at more boxes. */
export const CELL_CHUNK = 4

/** Outline resampling spacing, in mask cells, and the smoothing window half-width:
 *  enough that single-cell stair-steps don't read as curvature. */
export const OUTLINE_STEP = 1.2
export const OUTLINE_SMOOTH = 2
/** An outline with fewer samples than this is too small to letter along. */
export const MIN_OUTLINE_SAMPLES = 20
