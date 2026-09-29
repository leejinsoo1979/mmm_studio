import { describe, expect, test } from 'bun:test'
import { fitFace, placePoint } from './face-fit'

const target = {
  leftEye: [0.4, 0.45] as [number, number],
  rightEye: [0.6, 0.45] as [number, number],
  mouth: [0.5, 0.67] as [number, number],
}

describe('fitting a face photo by its eyes and mouth', () => {
  test('the marked points land on the character’s eyes and mouth', () => {
    // A portrait photo (4:3 tall), the face a little left of centre.
    const aspect = 4 / 3
    const marks: [[number, number], [number, number], [number, number]] = [
      [0.3, 0.4],
      [0.55, 0.4],
      [0.425, 0.6],
    ]
    const place = fitFace(marks, aspect, target)
    const [left, right, mouth] = marks.map((mark) => placePoint(mark, aspect, place))
    expect(left![0]).toBeCloseTo(0.4, 2)
    expect(left![1]).toBeCloseTo(0.45, 2)
    expect(right![0]).toBeCloseTo(0.6, 2)
    expect(mouth![0]).toBeCloseTo(0.5, 2)
    expect(mouth![1]).toBeCloseTo(0.67, 1)
    expect(place.rotation).toBeCloseTo(0, 5)
  })

  test('a tilted photo is turned upright', () => {
    const tilt = 0.2
    const rotate = ([x, y]: [number, number]): [number, number] => [
      0.5 + (x - 0.5) * Math.cos(tilt) - (y - 0.5) * Math.sin(tilt),
      0.5 + (x - 0.5) * Math.sin(tilt) + (y - 0.5) * Math.cos(tilt),
    ]
    const marks = [rotate([0.4, 0.45]), rotate([0.6, 0.45]), rotate([0.5, 0.67])] as [
      [number, number],
      [number, number],
      [number, number],
    ]
    const place = fitFace(marks, 1, target)
    expect(place.rotation).toBeCloseTo(-tilt, 5)
    const [left, right] = marks.map((mark) => placePoint(mark, 1, place))
    expect(left![0]).toBeCloseTo(0.4, 2)
    expect(right![1]).toBeCloseTo(0.45, 2)
  })
})
