import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { pickerDate } from "../src/date-picker-data";
import { SingleDateField } from "../src/date-picker";

describe("date picker integration", () => {
  it("keeps calendar dates stable across local Date, timestamp and string values", () => {
    for (const date of [
      "2024-02-29",
      "2024-03-10",
      "2024-11-03",
      "2026-01-01"
    ]) {
      const local = new Date(`${date}T00:00:00`);
      expect(pickerDate(local)).toBe(date);
      expect(pickerDate(local.getTime())).toBe(date);
      expect(pickerDate(date)).toBe(date);
    }
    for (const invalid of [
      undefined,
      null,
      "",
      "2023-02-29",
      "2024-02-30",
      new Date(NaN)
    ])
      expect(pickerDate(invalid)).toBeUndefined();
  });

  it("uses the real single-date calendar, closes on selection and supports a changed edit date", async () => {
    const onChange = jest.fn();
    const view = render(
      <SingleDateField value="2024-02-10" onChange={onChange} />
    );
    await act(async () =>
      fireEvent.press(
        screen.getByRole("button", { name: "Choose transaction date" })
      )
    );
    expect(onChange).not.toHaveBeenCalled();
    await act(async () =>
      fireEvent.press(screen.getByRole("button", { name: "29" }))
    );
    expect(onChange).toHaveBeenLastCalledWith("2024-02-29");
    expect(
      screen.queryByRole("button", { name: "Cancel date selection" })
    ).toBeNull();
    view.rerender(<SingleDateField value="2024-03-10" onChange={onChange} />);
    await act(async () =>
      fireEvent.press(
        screen.getByRole("button", { name: "Choose transaction date" })
      )
    );
    await act(async () =>
      fireEvent.press(screen.getByRole("button", { name: "11" }))
    );
    expect(onChange).toHaveBeenLastCalledWith("2024-03-11");
  }, 15000);

  it("cancels without changing the date and prevents selection while saving", async () => {
    const onChange = jest.fn();
    const view = render(
      <SingleDateField value="2024-02-10" onChange={onChange} />
    );
    await act(async () =>
      fireEvent.press(
        screen.getByRole("button", { name: "Choose transaction date" })
      )
    );
    await act(async () =>
      fireEvent.press(
        screen.getByRole("button", { name: "Cancel date selection" })
      )
    );
    expect(onChange).not.toHaveBeenCalled();
    view.rerender(
      <SingleDateField value="2024-02-10" onChange={onChange} disabled />
    );
    expect(
      screen.getByRole("button", { name: "Choose transaction date" })
    ).toBeDisabled();
  });

  it("uses the latest draft callback and disabled state while the calendar is open", async () => {
    const first = jest.fn(),
      latest = jest.fn();
    const view = render(
      <SingleDateField value="2024-02-10" onChange={first} />
    );
    await act(async () =>
      fireEvent.press(
        screen.getByRole("button", { name: "Choose transaction date" })
      )
    );
    view.rerender(<SingleDateField value="2024-02-10" onChange={latest} />);
    await act(async () =>
      fireEvent.press(screen.getByRole("button", { name: "11" }))
    );
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith("2024-02-11");
    await act(async () =>
      fireEvent.press(
        screen.getByRole("button", { name: "Choose transaction date" })
      )
    );
    view.rerender(
      <SingleDateField value="2024-02-10" onChange={latest} disabled />
    );
    await act(async () =>
      fireEvent.press(screen.getByRole("button", { name: "12" }))
    );
    expect(latest).toHaveBeenCalledTimes(1);
  }, 15000);
});
