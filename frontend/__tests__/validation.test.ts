import { describe, expect, test } from "vitest";

import {
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  EMAIL_PATTERN,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_PATTERN,
  validateDisplayName,
  validateEmail,
  validatePassword,
  validateUsername,
} from "@/lib/validation";

/** An address of exactly `length` characters, for the boundary tests. */
function emailOfLength(length: number): string {
  const suffix = "@example.com";
  return `${"a".repeat(length - suffix.length)}${suffix}`;
}

describe("USERNAME_PATTERN", () => {
  test.each([
    "abc",
    "jane_doe",
    "JaneDoe123",
    "___",
    "a".repeat(30),
  ])("accepts %o", (value) => {
    expect(USERNAME_PATTERN.test(value)).toBe(true);
  });

  test.each([
    "ab",
    "a".repeat(31),
    "jane doe",
    "jane-doe",
    "jane.doe",
    "jane@doe",
    "jane!",
    "jane/doe",
    "ácé",
  ])("rejects %o", (value) => {
    expect(USERNAME_PATTERN.test(value)).toBe(false);
  });
});

describe("EMAIL_PATTERN", () => {
  test.each(["a@b.co", "jane.doe@example.com", "j+tag@sub.example.co.uk"])(
    "accepts %o",
    (value) => {
      expect(EMAIL_PATTERN.test(value)).toBe(true);
    },
  );

  test.each([
    "jane",
    "jane@",
    "@example.com",
    "jane@example",
    "jane doe@example.com",
    "jane@exa mple.com",
    "jane@@example.com",
  ])("rejects %o", (value) => {
    expect(EMAIL_PATTERN.test(value)).toBe(false);
  });
});

describe("validateUsername", () => {
  test("rejects an empty value", () => {
    expect(validateUsername("")).toBe("Username is required.");
    expect(validateUsername("   ")).toBe("Username is required.");
  });

  test("accepts three characters", () => {
    expect(validateUsername("abc")).toBeUndefined();
  });

  test("accepts thirty characters", () => {
    expect(validateUsername("a".repeat(30))).toBeUndefined();
  });

  test("rejects two characters", () => {
    expect(validateUsername("ab")).toBe(
      "Username must be 3-30 characters, using only letters, digits and underscores.",
    );
  });

  test("rejects thirty-one characters", () => {
    expect(validateUsername("a".repeat(31))).toBe(
      "Username must be 3-30 characters, using only letters, digits and underscores.",
    );
  });

  test.each(["jane doe", "jane-doe", "jane.doe", "jane!"])(
    "rejects the disallowed characters in %o",
    (value) => {
      expect(validateUsername(value)).toBeDefined();
    },
  );

  test("ignores surrounding whitespace", () => {
    expect(validateUsername("  jane_doe  ")).toBeUndefined();
  });
});

describe("validatePassword", () => {
  test("rejects an empty value", () => {
    expect(validatePassword("")).toBe("Password is required.");
  });

  test("accepts the minimum length", () => {
    expect(validatePassword("a".repeat(PASSWORD_MIN_LENGTH))).toBeUndefined();
  });

  test("accepts the maximum length", () => {
    expect(validatePassword("a".repeat(PASSWORD_MAX_LENGTH))).toBeUndefined();
  });

  test("rejects one below the minimum", () => {
    expect(validatePassword("a".repeat(PASSWORD_MIN_LENGTH - 1))).toBe(
      "Password must be at least 8 characters.",
    );
  });

  test("rejects one above the maximum", () => {
    expect(validatePassword("a".repeat(PASSWORD_MAX_LENGTH + 1))).toBe(
      "Password must be 128 characters or fewer.",
    );
  });

  test("does not trim, because a space is a legitimate character", () => {
    // "        " is eight characters and the backend accepts it; trimming here
    // would reject input the API would have taken.
    expect(validatePassword("        ")).toBeUndefined();
    expect(validatePassword("       ")).toBe(
      "Password must be at least 8 characters.",
    );
  });

  test("accepts any characters within the length bounds", () => {
    expect(validatePassword("correct horse battery staple")).toBeUndefined();
    expect(validatePassword("🔐🔐🔐🔐🔐🔐🔐🔐")).toBeUndefined();
  });

  test("documents the known byte-versus-code-unit divergence", () => {
    // 40 emoji: accepted here (80 UTF-16 code units) but 160 bytes in Go, so
    // the backend rejects it. See the note in lib/validation.ts — the failure
    // is safe and legible, so the divergence is deliberate.
    const emoji = "🔐".repeat(40);
    expect(emoji.length).toBe(80);
    expect(validatePassword(emoji)).toBeUndefined();
  });
});

describe("validateEmail", () => {
  test("rejects an empty value", () => {
    expect(validateEmail("")).toBe("Email is required.");
    expect(validateEmail("   ")).toBe("Email is required.");
  });

  test("accepts a plausible address", () => {
    expect(validateEmail("jane.doe@example.com")).toBeUndefined();
  });

  test("accepts an address of exactly the maximum length", () => {
    const value = emailOfLength(EMAIL_MAX_LENGTH);
    expect(value).toHaveLength(254);
    expect(validateEmail(value)).toBeUndefined();
  });

  test("rejects an address one character over the maximum", () => {
    const value = emailOfLength(EMAIL_MAX_LENGTH + 1);
    expect(validateEmail(value)).toBe("Email must be 254 characters or fewer.");
  });

  test("reports the length problem before the shape problem", () => {
    // A 300-character string with no "@" fails both rules; length is checked
    // first, matching the backend's ordering.
    expect(validateEmail("a".repeat(300))).toBe(
      "Email must be 254 characters or fewer.",
    );
  });

  test("rejects a malformed address", () => {
    expect(validateEmail("jane")).toBe("Enter a valid email address.");
    expect(validateEmail("jane@example")).toBe("Enter a valid email address.");
  });

  test("ignores surrounding whitespace", () => {
    expect(validateEmail("  jane@example.com  ")).toBeUndefined();
  });
});

describe("validateDisplayName", () => {
  test("is optional, so an empty value is valid", () => {
    expect(validateDisplayName("")).toBeUndefined();
    expect(validateDisplayName("   ")).toBeUndefined();
  });

  test("accepts a name of exactly the maximum length", () => {
    expect(
      validateDisplayName("a".repeat(DISPLAY_NAME_MAX_LENGTH)),
    ).toBeUndefined();
  });

  test("rejects a name one character over the maximum", () => {
    expect(
      validateDisplayName("a".repeat(DISPLAY_NAME_MAX_LENGTH + 1)),
    ).toBe("Display name must be 50 characters or fewer.");
  });

  test("measures the trimmed value", () => {
    const padded = `${" ".repeat(10)}${"a".repeat(DISPLAY_NAME_MAX_LENGTH)}`;
    expect(validateDisplayName(padded)).toBeUndefined();
  });

  test("accepts characters a username would reject", () => {
    expect(validateDisplayName("Jane Doe 🎬")).toBeUndefined();
  });
});
