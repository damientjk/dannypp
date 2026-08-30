#!/usr/bin/env python3
"""Draw the crewmate character spritesheet the world renders its Agents with.

Procedural rather than ripped: the little spaceman bean is a recognisable
commercial character, so this synthesises an original crewmate-styled sprite
(rounded body, visor, backpack, stubby legs) instead of vendoring copyrighted
game art. It also means the sheet matches our own frame contract exactly.

Layout is the 3x3 grid `engineCharacter.buildCharacterFrames` slices:

    row 0 = facing down (toward camera)   col 0 = neutral / idle stance
    row 1 = facing up   (away, backpack)  col 1 = left foot forward
    row 2 = facing right (profile)        col 2 = right foot forward

`CharacterSprite` renders "left" as row 2 mirrored, so there is no left row.
Its walk cycle is [0, 1, 2, 1] and its idle is [0], which is why column 0 is a
clean standing pose rather than a step.

Every body pixel is pure white because `agentAppearance.colorForAgent` applies
a *multiply* tint per Agent: white takes the palette colour exactly, and the
darker visor/outline survive as shading. Painting the body a colour here would
multiply twice and turn every Agent into the same muddy silhouette.

One-off asset build — re-run only when the sprite design changes.

Usage: python3 generate-crewmate-sprite.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

WORLD_ASSETS = Path(__file__).resolve().parents[1] / "public" / "world-assets"
OUT_PATH = WORLD_ASSETS / "characters" / "default.png"

FRAME = 32
COLS = 3
ROWS = 3

# White body + dark outline is the only combination that stays legible under
# every tint in the palette (see the module docstring).
BODY = (255, 255, 255, 255)
BODY_SHADE = (202, 207, 219, 255)
VISOR = (104, 158, 200, 255)
VISOR_LIT = (188, 222, 245, 255)
OUTLINE = (42, 44, 56, 255)

# Bean geometry. Feet land on the frame's bottom row so the sprite sits flush
# on the floor tile -- CharacterSprite anchors at (0.5, 1), i.e. bottom-centre.
BODY_L, BODY_R = 9, 22
BODY_TOP, BODY_BOT = 4, 27
# How much of the bean's bottom is squared off. A rounded_rectangle at radius 6
# leaves only a 2px flat bottom edge, which turns the legs into spindly stilts
# hanging off a curve -- the crewmate silhouette needs a flat base to stand on.
BODY_SQUARE = 6
LEG_BOT = 31
LEG_W = 4


def draw_legs(draw: ImageDraw.ImageDraw, phase: int) -> None:
    """Two stubby legs. `phase` 0 = stand, 1 = left forward, 2 = right forward.

    A "step" shortens the trailing leg by 2px and nudges it inward, which at
    32px reads as a stride far more clearly than swinging both legs would.

    Drawn *after* the body, starting exactly on its bottom outline row: the
    leg's white interior punches through that row so the two silhouettes join,
    while the body's own bottom outline survives either side of each leg and
    between them. Starting even a pixel higher carves dark seams up into the
    torso; starting a pixel lower leaves the legs as detached boxes.
    """
    left_x, right_x = 11, 17
    left_bot, right_bot = LEG_BOT, LEG_BOT

    if phase == 1:
        right_x += 1
        right_bot -= 2
    elif phase == 2:
        left_x -= 1
        left_bot -= 2

    top = BODY_BOT
    for x, bot in ((left_x, left_bot), (right_x, right_bot)):
        right_edge = x + LEG_W - 1
        # Interior punches through the body's bottom outline row; the sides and
        # sole are re-outlined so the leg still reads as its own shape.
        draw.rectangle([x + 1, top, right_edge - 1, bot - 1], fill=BODY)
        draw.line([x, top, x, bot], fill=OUTLINE)
        draw.line([right_edge, top, right_edge, bot], fill=OUTLINE)
        draw.line([x, bot, right_edge, bot], fill=OUTLINE)


def draw_body(draw: ImageDraw.ImageDraw) -> None:
    draw.rounded_rectangle(
        [BODY_L, BODY_TOP, BODY_R, BODY_BOT],
        radius=6,
        fill=BODY,
        outline=OUTLINE,
        width=1,
    )
    # Square off the lower body: fill back over the rounded bottom corners,
    # then re-draw straight sides and a flat base for the legs to grow from.
    squared_top = BODY_BOT - BODY_SQUARE
    draw.rectangle([BODY_L, squared_top, BODY_R, BODY_BOT], fill=BODY)
    draw.line([BODY_L, squared_top, BODY_L, BODY_BOT], fill=OUTLINE)
    draw.line([BODY_R, squared_top, BODY_R, BODY_BOT], fill=OUTLINE)
    draw.line([BODY_L, BODY_BOT, BODY_R, BODY_BOT], fill=OUTLINE)
    # One soft shade along the bottom interior gives the bean a little volume.
    # Anything more reads as noise at 32px and as a second colour once tinted.
    draw.line([BODY_L + 3, BODY_BOT - 1, BODY_R - 3, BODY_BOT - 1], fill=BODY_SHADE)


def draw_backpack(draw: ImageDraw.ImageDraw, facing: str) -> None:
    if facing == "up":
        # Seen from behind: the pack sits centred on the back, fully enclosed.
        draw.rounded_rectangle([12, 9, 19, 21], radius=2, fill=BODY, outline=OUTLINE)
        draw.line([14, 12, 17, 12], fill=BODY_SHADE)
        draw.line([14, 15, 17, 15], fill=BODY_SHADE)
    elif facing == "right":
        # Profile: the pack juts off the trailing (left) side. Same merge trick
        # as the legs -- fill through the body edge, then outline three sides,
        # so the pack joins the bean instead of sitting beside it.
        draw.rectangle([5, 12, BODY_L + 1, 20], fill=BODY)
        draw.line([5, 12, 5, 20], fill=OUTLINE)
        draw.line([5, 12, BODY_L + 1, 12], fill=OUTLINE)
        draw.line([5, 20, BODY_L + 1, 20], fill=OUTLINE)


def draw_visor(draw: ImageDraw.ImageDraw, facing: str) -> None:
    if facing == "down":
        box = [11, 8, 20, 15]
        lit = [13, 10, 15, 11]
    elif facing == "right":
        # Runs out to the body's own right edge; stopping one pixel short
        # stacks the visor and body outlines into a dark blob.
        box = [14, 8, BODY_R, 15]
        lit = [16, 10, 18, 11]
    else:
        return  # facing away -- no visor

    draw.rounded_rectangle(box, radius=3, fill=VISOR, outline=OUTLINE, width=1)
    draw.rectangle(lit, fill=VISOR_LIT)


def draw_frame(facing: str, phase: int) -> Image.Image:
    frame = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
    draw = ImageDraw.Draw(frame)

    # Body first: the legs and the profile backpack both merge into it by
    # painting over its outline, so they have to land afterwards.
    draw_body(draw)
    draw_legs(draw, phase)
    draw_backpack(draw, facing)
    draw_visor(draw, facing)
    return frame


def main() -> None:
    sheet = Image.new("RGBA", (FRAME * COLS, FRAME * ROWS), (0, 0, 0, 0))
    for row, facing in enumerate(("down", "up", "right")):
        for phase in range(COLS):
            sheet.paste(draw_frame(facing, phase), (phase * FRAME, row * FRAME))

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT_PATH)
    print(f"wrote {OUT_PATH} ({sheet.width}x{sheet.height})")


if __name__ == "__main__":
    main()
