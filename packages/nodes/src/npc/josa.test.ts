import { describe, expect, test } from 'bun:test'
import { josa, withJosa } from './josa'

describe('josa', () => {
  test('와/과 in either order', () => {
    expect(withJosa('지아', '와', '과')).toBe('지아와')
    expect(withJosa('민준', '와', '과')).toBe('민준과')
    expect(withJosa('민준', '과', '와')).toBe('민준과')
  })

  test('이/가, 은/는, 을/를', () => {
    expect(withJosa('지아', '이', '가')).toBe('지아가')
    expect(withJosa('민준', '이', '가')).toBe('민준이')
    expect(josa('거실', '은', '는')).toBe('은')
    expect(josa('주방', '을', '를')).toBe('을')
    expect(josa('베란다', '을', '를')).toBe('를')
  })

  test('으로/로: ㄹ and vowels take 로', () => {
    expect(withJosa('거실', '으로', '로')).toBe('거실로')
    expect(withJosa('안방', '으로', '로')).toBe('안방으로')
    expect(withJosa('드레스룸', '으로', '로')).toBe('드레스룸으로')
    expect(withJosa('화장실', '으로', '로')).toBe('화장실로')
    expect(withJosa('베란다', '으로', '로')).toBe('베란다로')
  })

  test('이에요/예요 and 아/야', () => {
    expect(withJosa('지아', '이에요', '예요')).toBe('지아예요')
    expect(withJosa('민준', '이에요', '예요')).toBe('민준이에요')
    expect(withJosa('민준', '아', '야')).toBe('민준아')
  })

  test('digits read aloud, trailing symbols skipped, Latin as a vowel', () => {
    expect(withJosa('7', '으로', '로')).toBe('7로')
    expect(withJosa('3', '이', '가')).toBe('3이')
    expect(withJosa('2', '이', '가')).toBe('2가')
    expect(josa('거실(1층)', '으로', '로')).toBe('으로')
    expect(josa('TV', '이', '가')).toBe('가')
    expect(josa('', '이', '가')).toBe('가')
  })
})
