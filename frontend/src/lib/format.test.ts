import { describe, expect, it } from "vitest";

import {
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONES,
  REFUND_STATUS_LABELS,
  REFUND_STATUS_TONES,
  RETURN_STATUS_LABELS,
  RETURN_STATUS_TONES,
  TONE_CLASSES,
  addMoney,
  compareMoney,
  daysSince,
  formatDate,
  formatMoney,
  formatRelativeTime,
  fromMinorUnits,
  multiplyMoney,
  refundableBalance,
  returnWindowDaysLeft,
  subtractMoney,
  toMinorUnits,
} from "./format";

describe("toMinorUnits", () => {
  it("converts decimal strings to integer cents", () => {
    expect(toMinorUnits("49.99")).toBe(4999n);
    expect(toMinorUnits("49.9")).toBe(4990n);
    expect(toMinorUnits("49")).toBe(4900n);
    expect(toMinorUnits("0.05")).toBe(5n);
    expect(toMinorUnits("-5.25")).toBe(-525n);
  });

  it("ignores surrounding whitespace", () => {
    expect(toMinorUnits("  12.00 ")).toBe(1200n);
  });

  it.each(["", "abc", "1.234", "1,000.00", ".5", "5.", "+5", "1e3"])(
    "rejects malformed amount %j",
    (value) => {
      expect(() => toMinorUnits(value)).toThrow(/invalid money amount/i);
    },
  );
});

describe("fromMinorUnits", () => {
  it("converts integer cents back to decimal strings", () => {
    expect(fromMinorUnits(4999n)).toBe("49.99");
    expect(fromMinorUnits(5n)).toBe("0.05");
    expect(fromMinorUnits(0n)).toBe("0.00");
    expect(fromMinorUnits(100000n)).toBe("1000.00");
    expect(fromMinorUnits(-525n)).toBe("-5.25");
  });

  it("round-trips with toMinorUnits", () => {
    for (const value of ["0.00", "0.01", "12.50", "999999.99", "-3.10"]) {
      expect(fromMinorUnits(toMinorUnits(value))).toBe(value);
    }
  });
});

describe("money arithmetic", () => {
  it("adds without floating-point drift", () => {
    // 0.1 + 0.2 === 0.30000000000000004 with floats
    expect(addMoney("0.10", "0.20")).toBe("0.30");
  });

  it("subtracts", () => {
    expect(subtractMoney("10.00", "0.01")).toBe("9.99");
    expect(subtractMoney("5.00", "7.50")).toBe("-2.50");
  });

  it("multiplies by whole quantities", () => {
    expect(multiplyMoney("12.50", 2)).toBe("25.00");
    expect(multiplyMoney("19.99", 3)).toBe("59.97");
    expect(multiplyMoney("19.99", 0)).toBe("0.00");
  });

  it("rejects invalid quantities", () => {
    expect(() => multiplyMoney("5.00", -1)).toThrow(/invalid quantity/i);
    expect(() => multiplyMoney("5.00", 1.5)).toThrow(/invalid quantity/i);
  });

  it("compares amounts regardless of formatting", () => {
    expect(compareMoney("10.00", "9.99")).toBe(1);
    expect(compareMoney("9.99", "10.00")).toBe(-1);
    expect(compareMoney("5.00", "5.0")).toBe(0);
  });
});

describe("refundableBalance", () => {
  it("returns the remaining balance", () => {
    expect(refundableBalance("104.99", "0.00")).toBe("104.99");
    expect(refundableBalance("63.00", "45.00")).toBe("18.00");
  });

  it("never goes below zero", () => {
    expect(refundableBalance("50.00", "60.00")).toBe("0.00");
  });
});

describe("formatMoney", () => {
  it("formats with symbol, thousands separators and two decimals", () => {
    expect(formatMoney("1249.5", "USD")).toBe("$1,249.50");
    expect(formatMoney("0.5", "EUR")).toBe("€0.50");
    expect(formatMoney("1000000", "GBP")).toBe("£1,000,000.00");
  });

  it("formats negative amounts", () => {
    expect(formatMoney("-12.5", "USD")).toBe("-$12.50");
  });

  it("falls back to a dash for invalid input", () => {
    expect(formatMoney("oops", "USD")).toBe("—");
  });
});

describe("dates", () => {
  const now = new Date("2026-10-12T12:00:00Z");

  it("formats valid dates and handles missing or invalid ones", () => {
    // Noon UTC is the same month and year in every time zone.
    const formatted = formatDate("2026-10-12T12:00:00Z");
    expect(formatted).toContain("Oct");
    expect(formatted).toContain("2026");

    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("not a date")).toBe("—");
  });

  it("formats relative times against an injected clock", () => {
    expect(formatRelativeTime("2026-10-12T11:59:30Z", now)).toBe("30 seconds ago");
    expect(formatRelativeTime("2026-10-12T10:00:00Z", now)).toBe("2 hours ago");
    expect(formatRelativeTime("2026-10-11T12:00:00Z", now)).toBe("yesterday");
    expect(formatRelativeTime("2026-10-10T12:00:00Z", now)).toBe("2 days ago");
    expect(formatRelativeTime("2026-10-12T15:00:00Z", now)).toBe("in 3 hours");
    expect(formatRelativeTime(null, now)).toBe("—");
    expect(formatRelativeTime("nope", now)).toBe("—");
  });

  it("counts whole days since a date", () => {
    const demoNow = new Date("2026-10-12T09:00:00Z");
    expect(daysSince("2026-10-02T15:30:00Z", demoNow)).toBe(9);
    expect(daysSince(null, demoNow)).toBe(0);
  });
});

describe("returnWindowDaysLeft", () => {
  const demoNow = new Date("2026-10-12T09:00:00Z");

  it("returns the days remaining inside the window", () => {
    expect(returnWindowDaysLeft("2026-10-02T15:30:00Z", 30, demoNow)).toBe(21);
  });

  it("returns a negative number once the window has expired", () => {
    expect(returnWindowDaysLeft("2026-08-20T11:00:00Z", 30, demoNow)).toBe(-22);
  });

  it("returns null when the order has not been delivered", () => {
    expect(returnWindowDaysLeft(null, 30, demoNow)).toBeNull();
  });
});

describe("status labels and tones", () => {
  it("has a label and a tone for every status", () => {
    expect(Object.keys(RETURN_STATUS_TONES).sort()).toEqual(
      Object.keys(RETURN_STATUS_LABELS).sort(),
    );
    expect(Object.keys(PAYMENT_STATUS_TONES).sort()).toEqual(
      Object.keys(PAYMENT_STATUS_LABELS).sort(),
    );
    expect(Object.keys(REFUND_STATUS_TONES).sort()).toEqual(
      Object.keys(REFUND_STATUS_LABELS).sort(),
    );
  });

  it("only uses tones that have styles", () => {
    const tones = [
      ...Object.values(RETURN_STATUS_TONES),
      ...Object.values(PAYMENT_STATUS_TONES),
      ...Object.values(REFUND_STATUS_TONES),
    ];
    for (const tone of tones) {
      expect(TONE_CLASSES).toHaveProperty(tone);
    }
  });
});