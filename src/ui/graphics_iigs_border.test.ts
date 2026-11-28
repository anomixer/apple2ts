import { buildIigsBorderTexture, iigsBorderCycle, iigsBorderLayout, iigsBorderRasterLine } from "./graphics"

// The IIgs border is a raster: $C034's low nibble is the border colour and software
// paints a picture into it by writing that register at dot-timed positions while the
// beam is in the border rows. The XMAS Demo's menu marquee lives only in those
// samples, and its first screen paints the side borders too, so the mapping from the
// worker's per-video-cycle raster to the 53-column texture has to match gssquared's
// VPP exactly - a row or column off by one looks like "the marquee was not drawn at
// all", and a band that is half height (or a picture with black sides) is what the
// screen shows instead.
const CYCLES_PER_ROW = 65
const BAND_ROWS = 40
const makeRaster = (): Uint8Array => new Uint8Array(262 * CYCLES_PER_ROW)

const pixel = (texture: NonNullable<ReturnType<typeof buildIigsBorderTexture>>,
  row: number, column: number): number[] => {
  const index = (row * 53 + column) * 4
  return [texture.pixels[index], texture.pixels[index + 1], texture.pixels[index + 2]]
}

test("border texture samples the right border, the left border and the centre window", () => {
  // gssquared's 263x53 border texture: columns 0-6 are the right border (hcount
  // 0-6), 7-12 the left one (hcount 19-24) and 13-52 the centre (hcount 25-64).
  expect(iigsBorderCycle(0)).toBe(0)
  expect(iigsBorderCycle(6)).toBe(6)
  expect(iigsBorderCycle(7)).toBe(19)
  expect(iigsBorderCycle(12)).toBe(24)
  expect(iigsBorderCycle(13)).toBe(25)
  expect(iigsBorderCycle(52)).toBe(64)
})

test("border texture rows are the raster lines right after and right before the picture", () => {
  // apple2ts' refresh starts inside VBL, so its raster line 1 is the first row of
  // the bottom border and line 51 the first row of the top one, 70 lines total.
  expect(iigsBorderRasterLine(0)).toBe(1)
  expect(iigsBorderRasterLine(20)).toBe(21)
  expect(iigsBorderRasterLine(21)).toBe(51)
  expect(iigsBorderRasterLine(39)).toBe(69)
  // The side borders are the picture rows: 70-261 follow the bands.
  expect(iigsBorderRasterLine(BAND_ROWS)).toBe(70)
  expect(iigsBorderRasterLine(BAND_ROWS + 191)).toBe(261)
})

test("border texture maps every painted raster sample to its texture pixel", () => {
  const raster = makeRaster()
  // A glossy white stroke across the centre window on the third bottom-border row
  // (raster line 3), exactly what the demo's marquee looks like per refresh.
  for (let cycle = 25; cycle < 37; cycle++) raster[3 * CYCLES_PER_ROW + cycle] = 0x0f
  // The right border column at hcount 2 carries colour 4 on the first row. That
  // sample is the tail of the previous video line, i.e. raster line 2's leading
  // cycles, not raster line 1's.
  raster[2 * CYCLES_PER_ROW + 2] = 0x04
  // The top border starts at raster line 51: colour 12 down the left border.
  for (let row = 21; row < 39; row++) raster[(51 + row - 21) * CYCLES_PER_ROW + 19] = 0x0c

  const texture = buildIigsBorderTexture(raster)
  expect(texture).not.toBeNull()
  expect(texture!.topPainted).toBe(true)
  expect(texture!.bottomPainted).toBe(true)
  expect(texture!.sidePainted).toBe(false)

  // Row 2 of the texture is raster line 3; centre columns 13-52 cover hcount 25-64.
  expect(pixel(texture!, 2, 12)).toEqual([0x00, 0x00, 0x00])  // hcount 24, left border - not painted
  expect(pixel(texture!, 2, 13)).toEqual([0xff, 0xff, 0xff])  // colour 15
  expect(pixel(texture!, 2, 24)).toEqual([0xff, 0xff, 0xff])  // hcount 36
  expect(pixel(texture!, 2, 25)).toEqual([0x00, 0x00, 0x00])  // hcount 37 - no longer painted
  expect(pixel(texture!, 2, 0)).toEqual([0x00, 0x00, 0x00])
  // First bottom row: colour 4 at the right border only.
  expect(pixel(texture!, 0, 2)).toEqual([0x00, 0x77, 0x22])
  expect(pixel(texture!, 0, 3)).toEqual([0x00, 0x00, 0x00])
  // Every top-border row carries colour 12 on the left border column 7 (hcount 19).
  for (let row = 21; row < 39; row++) expect(pixel(texture!, row, 7)).toEqual([0x11, 0xdd, 0x00])
})

test("border texture keeps the side borders of the picture rows", () => {
  const raster = makeRaster()
  // The demo's first screen sets a grey border once and leaves it on the wire: the
  // left and right margins of every picture row carry that colour.
  for (let line = 70; line < 262; line++) {
    for (const cycle of [0, 3, 6, 19, 22, 24]) raster[line * CYCLES_PER_ROW + cycle] = 0x0a
  }
  // The centre window of a picture row is the picture, not border colour.
  for (let line = 70; line < 262; line++) raster[line * CYCLES_PER_ROW + 30] = 0x0f

  // The right border of the last picture row comes from the frame's first line, so
  // the wrap row has to carry the colour too.
  for (const cycle of [0, 3, 6]) raster[0 * CYCLES_PER_ROW + cycle] = 0x0a

  const texture = buildIigsBorderTexture(raster)
  expect(texture).not.toBeNull()
  expect(texture!.sidePainted).toBe(true)
  // Side rows sit after the bands, one per visible raster line.
  expect(pixel(texture!, BAND_ROWS, 0)).toEqual([0xaa, 0xaa, 0xaa])
  expect(pixel(texture!, BAND_ROWS, 7)).toEqual([0xaa, 0xaa, 0xaa])
  expect(pixel(texture!, BAND_ROWS + 191, 6)).toEqual([0xaa, 0xaa, 0xaa])
  // Picture pixels are kept out of the side columns' flag: the centre stays picture.
  // hcount 30 is column 18 (13-52 sample hcount 25-64).
  expect(pixel(texture!, BAND_ROWS, 18)).toEqual([0xff, 0xff, 0xff])
})

test("the right border is the tail of its own video line, not the previous one", () => {
  // The right margin of a line is emitted after the line's active dots, so its seven
  // samples sit in the leading cycles of the NEXT line. Reading them from the same
  // row put the right border one scanline below the picture: on the X-MAS split demo
  // the full-width colour bars stepped by one line at the right edge only.
  const raster = makeRaster()
  // Line 70's leading cycles are line 69's tail; line 71's are the tail of line 70,
  // the one that belongs beside the first picture row (texture row BAND_ROWS).
  raster[70 * CYCLES_PER_ROW + 2] = 0x09 // orange, on the wire at line 69's end
  raster[71 * CYCLES_PER_ROW + 2] = 0x0a // grey, on the wire at line 70's end
  // The frame wraps: the last picture line's right border is the start of line 0.
  raster[0 * CYCLES_PER_ROW + 4] = 0x0c // green

  const texture = buildIigsBorderTexture(raster)
  expect(texture).not.toBeNull()
  // Last row of the top band is raster line 69, so its right border is line 70's start.
  expect(pixel(texture!, BAND_ROWS - 1, 2)).toEqual([0xff, 0x66, 0x00])
  // First picture row (raster line 70) takes line 71's leading cycles.
  expect(pixel(texture!, BAND_ROWS, 2)).toEqual([0xaa, 0xaa, 0xaa])
  // Last picture row is raster line 261, whose tail is line 0's leading cycles.
  expect(pixel(texture!, BAND_ROWS + 191, 4)).toEqual([0x11, 0xdd, 0x00])
})

test("border texture is not drawn when the raster was never painted", () => {
  const texture = buildIigsBorderTexture(makeRaster())
  expect(texture).not.toBeNull()
  expect(texture!.bottomPainted).toBe(false)
  expect(texture!.topPainted).toBe(false)
  expect(texture!.sidePainted).toBe(false)
})

test("border texture rejects a raster that is too short", () => {
  expect(buildIigsBorderTexture(new Uint8Array())).toBeNull()
  expect(buildIigsBorderTexture(new Uint8Array(261 * CYCLES_PER_ROW))).toBeNull()
})

test("border bands are one video line per row and start on the window's last lines", () => {
  // gssquared's VPP: 21 bottom rows on picture lines 192-212, 19 top rows on -19..-1.
  const layout = iigsBorderLayout(400)
  expect(layout.rowHeight).toBe(2)
  expect(layout.bottomTop).toBe(384)
  expect(layout.topTop).toBe(-38)
  // One band row is as tall as one SHR line: the 8 lines of overlap the demo relies
  // on put the marquee's first rows inside the picture instead of under it.
  expect(layout.bottomTop + 8 * layout.rowHeight).toBe(400)
  expect(layout.bottomTop + 21 * layout.rowHeight).toBe(426)
})
