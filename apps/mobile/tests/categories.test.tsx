import { describe, expect, it, jest } from "@jest/globals";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react-native";
import { CategoryManagement } from "../src/category-management";
import {
  createDemoCategorySource,
  type CategorySource
} from "../src/category-data";

async function press(name: string) {
  await act(async () => {
    await fireEvent.press(screen.getByRole("button", { name }));
  });
}
async function name(value: string) {
  await act(async () => {
    await fireEvent.changeText(screen.getByLabelText("Category name"), value);
  });
}
async function open(source = createDemoCategorySource()) {
  render(<CategoryManagement source={source} />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Add category" })).toBeVisible()
  );
  return source;
}
async function add(value: string) {
  await press("Add category");
  await name(value);
  await press("Save category");
}

describe("category management", () => {
  it("validates, normalizes and renames while retaining invalid/duplicate input", async () => {
    await open();
    await add("   ");
    expect(screen.getByRole("alert")).toHaveProp(
      "accessibilityLabel",
      expect.stringContaining("visible category name")
    );
    expect(screen.getByLabelText("Category name")).toHaveProp("value", "   ");
    await name(" Daily\tfood ");
    await press("Save category");
    expect(screen.getByText("Daily food")).toBeVisible();
    await add("daily FOOD");
    expect(screen.getByRole("alert")).toHaveProp(
      "accessibilityLabel",
      expect.stringContaining("already uses this name")
    );
    expect(screen.getByLabelText("Category name")).toHaveProp(
      "value",
      "daily FOOD"
    );
    await press("Cancel editing");
    await press("Edit Daily food");
    await name("Groceries");
    await press("Save category");
    expect(screen.getByText("Groceries")).toBeVisible();
    expect(screen.queryByText("Daily food")).toBeNull();
  });

  it("requires archive confirmation, supports cancellation, hides archived actions and permits name reuse", async () => {
    const source = await open();
    await add("Food");
    await press("Archive Food");
    expect(
      screen.getByText(/Past transactions keep this category/)
    ).toBeVisible();
    expect((await source.list())[0]?.archivedAt).toBeNull();
    await press("Cancel archive");
    expect(screen.getByText("Food")).toBeVisible();
    await press("Archive Food");
    await press("Confirm archive");
    expect(screen.queryByText("Food")).toBeNull();
    await press("Show archived categories");
    expect(screen.getByText("Food (archived)")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Edit Food" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive Food" })).toBeNull();
    await press("Show active categories");
    await add("FOOD");
    expect(screen.getByText("FOOD")).toBeVisible();
    const rows = await source.list();
    expect(rows).toHaveLength(2);
    expect(rows[0]?.id).not.toBe(rows[1]?.id);
  });

  it("recovers from list failure and retains input after a write failure without displaying raw errors", async () => {
    const demo = createDemoCategorySource();
    const list = jest
      .fn<CategorySource["list"]>()
      .mockRejectedValueOnce(new Error("private diagnostic"))
      .mockImplementation(() => demo.list());
    const source: CategorySource = {
      ...demo,
      list,
      create: async () => {
        throw new Error("private diagnostic");
      }
    };
    render(<CategoryManagement source={source} />);
    await waitFor(() =>
      expect(screen.getByText("Categories unavailable")).toBeVisible()
    );
    expect(screen.queryByText(/private diagnostic/)).toBeNull();
    await press("Try again");
    await add("Keep my input");
    expect(screen.getByLabelText("Category name")).toHaveProp(
      "value",
      "Keep my input"
    );
    expect(screen.queryByText(/private diagnostic/)).toBeNull();
    expect(screen.getByRole("alert")).toHaveProp(
      "accessibilityLabel",
      expect.stringContaining("Try again")
    );
  });

  it("disables duplicate submissions while a change is pending", async () => {
    let finish!: () => void;
    const demo = createDemoCategorySource();
    const create = jest.fn<CategorySource["create"]>().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    await open({ ...demo, create });
    await add("Pending");
    expect(
      screen.getByRole("button", { name: "Save category" })
    ).toBeDisabled();
    await press("Save category");
    expect(create).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add category" })).toBeVisible()
    );
  });

  it("reloads after a successful write followed by a read failure, without replaying the write", async () => {
    const demo = createDemoCategorySource();
    const list = jest
      .fn<CategorySource["list"]>()
      .mockImplementationOnce(() => demo.list())
      .mockRejectedValueOnce(new Error("read failed"))
      .mockImplementation(() => demo.list());
    const create = jest
      .fn<CategorySource["create"]>()
      .mockImplementation((value) => demo.create(value));
    await open({ ...demo, list, create });
    await add("Saved once");
    expect(screen.getByText("Categories unavailable")).toBeVisible();
    await press("Try again");
    expect(screen.getByText("Saved once")).toBeVisible();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([
    "",
    "\t\n",
    "\u00a0",
    "x".repeat(101),
    "bad\u200bname",
    "bad\u0000name",
    "\ud800"
  ])("rejects invalid demo name %j", async (value) => {
    await expect(
      createDemoCategorySource().create(value)
    ).rejects.toMatchObject({ code: "validation" });
  });
});
