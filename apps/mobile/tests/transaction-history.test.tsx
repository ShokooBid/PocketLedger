import { describe,expect,it,jest } from "@jest/globals";
import { act,fireEvent,render,screen,waitFor } from "@testing-library/react-native";
import { TransactionManagement } from "../src/transaction-management";
import { appendTransactionPage,reconcileTransactions,transactionKey } from "../src/transaction-history";
import { createDemoTransactionSource,type Transaction,type TransactionPage,type TransactionSource } from "../src/transaction-data";
import { createDemoCategorySource } from "../src/category-data";
import { ClientFailure } from "../src/auth/transport";

const row=(n:number,date="2026-10-01"):Transaction=>({id:`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`,categoryId:"demo-1",direction:"expense",amountMinor:n,currency:"USD",date,merchant:`Synthetic ${n}`,note:null,createdAt:"2026-10-01T00:00:00.000Z",updatedAt:"2026-10-01T00:00:00.000Z"});
async function press(name:string){await act(async()=>{fireEvent.press(screen.getByRole("button",{name}));});}
async function field(label:string,value:string){await act(async()=>{fireEvent.changeText(screen.getByLabelText(label),value);});}
async function fixture(count=3){
  const categories=createDemoCategorySource();await categories.create("Food");await categories.create("Work");
  const source=createDemoTransactionSource(categories);
  for(let n=1;n<=count;n++){const {id:_id,createdAt:_created,updatedAt:_updated,...input}=row(n);await source.create({...input,direction:n===2?"income":"expense",date:n===2?"2026-10-02":"2026-10-01"});}
  return {categories,source};
}
async function open(source:TransactionSource,categories:Awaited<ReturnType<typeof fixture>>["categories"],detailId?:string){
  render(<TransactionManagement source={source} categories={categories} {...(detailId?{detailId}:{})} />);
  await waitFor(()=>expect(screen.getByRole("button",{name:"Reload transactions and categories"})).toBeEnabled());
}
const names=()=>screen.queryAllByRole("button",{name:/^Edit Synthetic/}).map(node=>node.props.accessibilityLabel);

describe("history page rules",()=>{
  it("appends same-day ties once and preserves existing order and values",()=>{
    const previous=[row(4),row(3)];
    const merged=appendTransactionPage(previous,{items:[row(3),row(2),row(2),row(1)],nextCursor:null},transactionKey(row(3)));
    expect(merged.map(item=>item.id)).toEqual([4,3,2,1].map(n=>row(n).id));
    expect(merged[0]).toBe(previous[0]);expect(previous).toHaveLength(2);
  });
  it("rejects out-of-order pages and nonadvancing cursors without changing history",()=>{
    const previous=[row(4)];
    for(const page of [{items:[row(2),row(3)],nextCursor:null},{items:[row(5)],nextCursor:null},{items:[],nextCursor:transactionKey(row(3))},{items:[row(3)],nextCursor:transactionKey(row(4))}])expect(()=>appendTransactionPage(previous,page,transactionKey(row(4)))).toThrow();
    expect(previous).toEqual([row(4)]);
  });
  it("reconciles edits with active filters and orders changed dates deterministically",()=>{
    const previous=[row(3),row(2),row(1)];
    const updated={...row(1),date:"2026-10-03"};
    expect(reconcileTransactions(previous,{type:"saved",row:updated},{}).map(item=>item.id)).toEqual([row(1).id,row(3).id,row(2).id]);
    expect(reconcileTransactions(previous,{type:"saved",row:{...row(2),direction:"income"}},{direction:"expense"}).map(item=>item.id)).toEqual([row(3).id,row(1).id]);
  });
});
describe("transaction history and details",()=>{
  it("applies combined filters, keeps them on edits, and clears them in one action",async()=>{
    const {source,categories}=await fixture();const list=jest.fn(source.list);await open({...source,list},categories);
    await field("From date filter (YYYY-MM-DD)","2026-10-01");await field("To date filter (YYYY-MM-DD)","2026-10-01");await press("Filter: expense");await press("Filter category: Food");await press("Apply filters");
    expect(list).toHaveBeenLastCalledWith({from:"2026-10-01",to:"2026-10-01",direction:"expense",categoryId:"demo-1"},undefined);
    expect(names()).toEqual(["Edit Synthetic 3","Edit Synthetic 1"]);
    await press("Edit Synthetic 3");await press("Income");await press("Save transaction");
    expect(names()).toEqual(["Edit Synthetic 1"]);expect(screen.getByText(/no longer matches/)).toBeVisible();
    expect(screen.getByLabelText("From date filter (YYYY-MM-DD)")).toHaveProp("value","2026-10-01");
    await press("Clear filters");expect(names()).toEqual(["Edit Synthetic 2","Edit Synthetic 3","Edit Synthetic 1"]);
    expect(list).toHaveBeenLastCalledWith({},undefined);expect(screen.getByLabelText("From date filter (YYYY-MM-DD)")).toHaveProp("value","");
  });
  it("retains rows while loading more, locks duplicate loads, and retries failed pages at the same cursor",async()=>{
    const {source,categories}=await fixture(0);const cursor=transactionKey(row(3));let resolve!:(page:TransactionPage)=>void;
    const list=jest.fn<TransactionSource["list"]>().mockResolvedValueOnce({items:[row(4),row(3)],nextCursor:cursor}).mockImplementationOnce(()=>new Promise(yes=>{resolve=yes;})).mockRejectedValueOnce(new ClientFailure("network")).mockResolvedValueOnce({items:[row(1)],nextCursor:null});
    await open({...source,list},categories);await press("Load more transactions");await press("Load more transactions");expect(list).toHaveBeenCalledTimes(2);expect(names()).toEqual(["Edit Synthetic 4","Edit Synthetic 3"]);
    await act(async()=>resolve({items:[row(3),row(2)],nextCursor:transactionKey(row(2))}));expect(names()).toEqual(["Edit Synthetic 4","Edit Synthetic 3","Edit Synthetic 2"]);
    await press("Load more transactions");expect(names()).toHaveLength(3);expect(screen.getByRole("alert")).toHaveProp("accessibilityLabel",expect.stringContaining("current rows are unchanged"));
    await press("Load more transactions");expect(list.mock.calls[2]).toEqual(list.mock.calls[3]);expect(names()).toEqual(["Edit Synthetic 4","Edit Synthetic 3","Edit Synthetic 2","Edit Synthetic 1"]);
    expect(screen.queryByRole("button",{name:"Load more transactions"})).toBeNull();
  });
  it("does not resurrect a deleted record from an older in-flight read",async()=>{
    const {source,categories}=await fixture(1);let resolve!:(page:TransactionPage)=>void;
    const stale=await source.list({});const list=jest.fn(source.list).mockImplementationOnce(source.list).mockImplementationOnce(()=>new Promise(yes=>{resolve=yes;}));
    await open({...source,list},categories);await press("Reload transactions and categories");await act(async()=>source.remove(stale.items[0]!.id));await act(async()=>resolve(stale));expect(names()).toEqual([]);
    expect(screen.getByRole("alert")).toHaveProp("accessibilityLabel",expect.stringContaining("changed while loading"));
  });
  it("loads details by ID, cancels edits/deletion, updates the record, and shows a deleted state",async()=>{
    const {source,categories}=await fixture(1);const id=(await source.list({})).items[0]!.id;const get=jest.fn(source.get);
    await open({...source,get},categories,id);expect(get).toHaveBeenCalledWith(id);expect(screen.queryByRole("button",{name:"Apply filters"})).toBeNull();expect(screen.getByText(/^Created:/)).toBeVisible();
    await press("Edit Synthetic 1");await field("Merchant or payee","Cancelled edit");await press("Cancel editing");expect((await source.get(id)).merchant).toBe("Synthetic 1");
    await press("Edit Synthetic 1");await field("Merchant or payee","Corrected");await press("Save transaction");expect(screen.getByRole("button",{name:"Edit Corrected"})).toBeVisible();
    await press("Delete Corrected");await press("Keep transaction");expect((await source.get(id)).merchant).toBe("Corrected");
    await press("Delete Corrected");await press("Confirm delete transaction");expect(screen.getByText(/Transaction deleted. Return/)).toBeVisible();await expect(source.get(id)).rejects.toMatchObject({kind:"unavailable"});
  });
  it("shows the same unavailable detail for missing or foreign records and can retry a network failure",async()=>{
    const {source,categories}=await fixture(0);const get=jest.fn<TransactionSource["get"]>().mockRejectedValueOnce(new ClientFailure("network")).mockRejectedValue(new ClientFailure("unavailable"));
    await open({...source,get},categories,row(1).id);expect(screen.getByRole("alert")).toBeVisible();await press("Reload transactions and categories");expect(screen.getByText(/This transaction is unavailable/)).toBeVisible();expect(names()).toEqual([]);
  });
});
