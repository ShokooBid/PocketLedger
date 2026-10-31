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
  CategoryFailure,
  type CategorySource
} from "../src/category-data";
import {
  activeCategoryChildren,
  categoryPath,
  orderedCategories
} from "../src/category-hierarchy";

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
  it("explains the supported-client gate when loading a legacy category source", async () => {
    const source: CategorySource = {
      list: async () => {
        throw new CategoryFailure("upgrade");
      },
      create: async () => {},
      rename: async () => {},
      archive: async () => {}
    };
    render(<CategoryManagement source={source} demo={false} />);
    await waitFor(() =>
      expect(
        screen.getByText(/require a newer version of PocketLedger/)
      ).toBeVisible()
    );
    expect(screen.queryByRole("button", { name: "Add category" })).toBeNull();
  });
  it("shows hierarchy paths, protects defaults and creates personal children under either root kind", async () => {
    const rows = [
      {
        id: "fixed",
        name: "Fixed",
        isDefault: true,
        archivedAt: null,
        parentId: null
      },
      {
        id: "own",
        name: "Personal",
        isDefault: false,
        archivedAt: null,
        parentId: null
      },
      {
        id: "fixed-child",
        name: "Common",
        isDefault: true,
        archivedAt: null,
        parentId: "fixed"
      },
      {
        id: "own-child",
        name: "Common",
        isDefault: false,
        archivedAt: null,
        parentId: "own"
      }
    ];
    const createChild = jest
      .fn<NonNullable<CategorySource["createChild"]>>()
      .mockResolvedValue("new-child");
    await open({
      hierarchy: true,
      list: async () => rows,
      create: async () => {},
      createChild,
      rename: async () => {},
      archive: async () => {}
    });
    expect(screen.getByText("Fixed / Common (default)")).toBeVisible();
    expect(screen.getByText("Personal / Common")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Edit Fixed" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive Fixed" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Add subcategory under Common" })
    ).toBeNull();
    for (const [label, id] of [
      ["Fixed", "fixed"],
      ["Personal", "own"]
    ] as const) {
      await press(`Add subcategory under ${label}`);
      await name("New child");
      await press("Save category");
      expect(createChild).toHaveBeenLastCalledWith("New child", id);
    }
  });
  it("confirms affected active descendants before archiving a parent", async () => {
    const rows = [
      {
        id: "root",
        name: "Parent",
        parentId: null,
        isDefault: false,
        archivedAt: null
      },
      {
        id: "child",
        name: "Active child",
        parentId: "root",
        isDefault: false,
        archivedAt: null
      },
      {
        id: "old",
        name: "Old child",
        parentId: "root",
        isDefault: false,
        archivedAt: "2026-10-30T00:00:00Z"
      }
    ];
    const archive = jest
      .fn<CategorySource["archive"]>()
      .mockResolvedValue(undefined);
    await open({
      hierarchy: true,
      list: async () => rows,
      create: async () => {},
      rename: async () => {},
      archive
    });
    await press("Archive Parent");
    expect(screen.getByText(/Also archives: Active child/)).toBeVisible();
    expect(archive).not.toHaveBeenCalled();
    await press("Cancel archive");
    expect(archive).not.toHaveBeenCalled();
    await press("Archive Parent");
    await press("Confirm archive");
    expect(archive).toHaveBeenCalledWith("root");
    expect(activeCategoryChildren(rows[0]!, rows).map((row) => row.id)).toEqual(
      ["child"]
    );
    expect(categoryPath(rows[1]!, rows)).toBe("Parent / Active child");
    expect(
      orderedCategories([rows[2]!, rows[1]!, rows[0]!]).map((row) => row.id)
    ).toEqual(["root", "child", "old"]);
  });
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

  it("requires a read after an ambiguous API write before offering another submission", async () => {
    const demo = createDemoCategorySource();
    const create = jest
      .fn<CategorySource["create"]>()
      .mockImplementation(async (value) => {
        await demo.create(value); // The server committed but the response was lost.
        throw new CategoryFailure("uncertain");
      });
    await open({ ...demo, create });
    await add("Saved remotely");
    expect(screen.queryByRole("button", { name: "Save category" })).toBeNull();
    expect(
      screen.getByText(/Reload the list before making another change/)
    ).toBeVisible();
    await press("Try again");
    expect(screen.getByText("Saved remotely")).toBeVisible();
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
