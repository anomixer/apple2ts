import { buildIigsBorderTexture, iigsBorderCycle, iigsBorderRasterLine } from "./graphics"

// The IIgs border is a raster: $C034's low nibble is the border colour and software
// paints a picture into it by writing that register at dot-timed positions while the
// beam is in the border rows. The XMAS Demo's menu marquee lives only in those
// samples, so the mapping from the worker's per-video-cycle raster to the 53-column
// texture has to match gssquared's VPP exactly - a row or column off by one looks
// like "the marquee was not drawn at all", and a vertical stripe of colour is the
// only thing on screen to compare with.
const CYCLES_PER_ROW = 65
const makeRaster = (): Uint8Array => new Uint8Array(70 * CYCLES_PER_ROW)

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
})

test("border texture maps every painted raster sample to its texture pixel", () => {
  const raster = makeRaster()
  // A glossy white stroke across the centre window on the third bottom-border row
  // (raster line 3), exactly what the demo's marquee looks like per refresh.
  for (let cycle = 25; cycle < 37; cycle++) raster[3 * CYCLES_PER_ROW + cycle] = 0x0f
  // The right border column at hcount 2 carries colour 4 on the first row.
  raster[1 * CYCLES_PER_ROW + 2] = 0x04
  // The top border starts at raster line 51: colour 12 down the left border.
  for (let row = 21; row < 39; row++) raster[(51 + row - 21) * CYCLES_PER_ROW + 19] = 0x0c

  const texture = buildIigsBorderTexture(raster)
  expect(texture).not.toBeNull()
  expect(texture!.topPainted).toBe(true)
  expect(texture!.bottomPainted).toBe(true)

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

test("border texture is not drawn when the raster was never painted", () => {
  const texture = buildIigsBorderTexture(makeRaster())
  expect(texture).not.toBeNull()
  expect(texture!.bottomPainted).toBe(false)
  expect(texture!.topPainted).toBe(false)
})

test("border texture rejects a raster that is too short", () => {
  expect(buildIigsBorderTexture(new Uint8Array())).toBeNull()
  expect(buildIigsBorderTexture(new Uint8Array(69 * CYCLES_PER_ROW))).toBeNull()
})
