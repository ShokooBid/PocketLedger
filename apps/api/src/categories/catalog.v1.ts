// User-confirmed version 1. Keys are permanent identities, independent of labels.
const groups = [
  {
    key: "food-drinks",
    name: "Food & Drinks",
    children: [
      ["bar-cafe", "Bar, cafe"],
      ["groceries", "Groceries"],
      ["restaurant-fast-food", "Restaurant, fast-food"]
    ]
  },
  {
    key: "shopping",
    name: "Shopping",
    children: [
      ["clothes-shoes", "Clothes & shoes"],
      ["drug-store-chemist", "Drug-store, chemist"],
      ["electronics-accessories", "Electronics, accessories"],
      ["free-time", "Free time"],
      ["gifts-joy", "Gifts, joy"],
      ["health-beauty", "Health and beauty"],
      ["home-garden", "Home, garden"],
      ["jewels-accessories", "Jewels, accessories"],
      ["kids", "Kids"],
      ["pets-animals", "Pets, animals"],
      ["stationery-tools", "Stationery, tools"]
    ]
  },
  {
    key: "housing",
    name: "Housing",
    children: [
      ["energy-utilities", "Energy, utilities"],
      ["maintenance-repairs", "Maintenance, repairs"],
      ["mortgage", "Mortgage"],
      ["property-insurance", "Property insurance"],
      ["rent", "Rent"],
      ["services", "Services"]
    ]
  },
  {
    key: "transportation",
    name: "Transportation",
    children: [
      ["business-trips", "Business trips"],
      ["long-distance", "Long distance"],
      ["public-transport", "Public transport"],
      ["taxi", "Taxi"]
    ]
  },
  {
    key: "vehicle",
    name: "Vehicle",
    children: [
      ["fuel", "Fuel"],
      ["leasing", "Leasing"],
      ["parking", "Parking"],
      ["rentals", "Rentals"],
      ["vehicle-insurance", "Vehicle insurance"],
      ["vehicle-maintenance", "Vehicle maintenance"]
    ]
  },
  {
    key: "life-entertainment",
    name: "Life & Entertainment",
    children: [
      ["active-sport-fitness", "Active sport, fitness"],
      ["alcohol-tobacco", "Alcohol, tobacco"],
      ["books-audio-subscriptions", "Books, audio, subscriptions"],
      ["charity-gifts", "Charity, gifts"],
      ["culture-sport-events", "Culture, sport events"],
      ["education-development", "Education, development"],
      ["health-care-doctor", "Health care, doctor"],
      ["hobbies", "Hobbies"],
      ["holiday-trips-hotels", "Holiday, trips, hotels"],
      ["life-events", "Life events"],
      ["lottery-gambling", "Lottery, gambling"],
      ["tv-streaming", "TV, Streaming"],
      ["wellness-beauty", "Wellness, beauty"]
    ]
  },
  {
    key: "communication-pc",
    name: "Communication, PC",
    children: [
      ["internet", "Internet"],
      ["phone-cell-phone", "Phone, cell phone"],
      ["postal-services", "Postal services"],
      ["software-apps-games", "Software, apps, games"]
    ]
  },
  {
    key: "financial-expenses",
    name: "Financial expenses",
    children: [
      ["advisory", "Advisory"],
      ["charges-fees", "Charges, Fees"],
      ["child-support", "Child Support"],
      ["fines", "Fines"],
      ["insurances", "Insurances"],
      ["loan-interests", "Loan, interests"],
      ["taxes", "Taxes"]
    ]
  },
  {
    key: "investments",
    name: "Investments",
    children: [
      ["collections", "Collections"],
      ["financial-investments", "Financial investments"],
      ["realty", "Realty"],
      ["savings", "Savings"],
      ["vehicles-chattels", "Vehicles, chattels"]
    ]
  },
  {
    key: "income",
    name: "Income",
    children: [
      ["checks-coupons", "Checks, coupons"],
      ["child-support", "Child Support"],
      ["dues-grants", "Dues & grants"],
      ["gifts", "Gifts"],
      ["interests-dividends", "Interests, dividends"],
      ["lending-renting", "Lending, renting"],
      ["lottery-gambling", "Lottery, gambling"],
      ["refunds", "Refunds (tax, purchase)"],
      ["rental-income", "Rental income"],
      ["sale", "Sale"],
      ["wage-invoices", "Wage, invoices"]
    ]
  }
] as const;

export type CatalogCategory = {
  key: string;
  parentKey: string | null;
  name: string;
  iconKey: string;
  colorKey: string;
  sortOrder: number;
};
// Stable semantic asset keys, bounded by Category.iconKey's 40-character limit.
const iconPrefix = (key: string) =>
  key === "life-entertainment" ? "life" : key;
// Framework-free, serializable manifest; separate from synthetic/demo seeds.
export const defaultCategoryCatalog: {
  version: 1;
  items: readonly CatalogCategory[];
} = {
  version: 1,
  items: groups.flatMap((group, index) => [
    {
      key: group.key,
      parentKey: null,
      name: group.name,
      iconKey: iconPrefix(group.key),
      colorKey: "neutral",
      sortOrder: (index + 1) * 10
    },
    ...group.children.map(([key, name], childIndex) => ({
      key: `${group.key}.${key}`,
      parentKey: group.key,
      name,
      iconKey: `${iconPrefix(group.key)}-${key}`,
      colorKey: "neutral",
      sortOrder: (childIndex + 1) * 10
    }))
  ])
};
