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

// Permanent IDs: append new keys deliberately; never renumber existing entries.
const catalogIds: Record<string, string> = {
  "food-drinks": "c96a1000-0000-4000-8000-000000000001",
  "food-drinks.bar-cafe": "c96a1000-0000-4000-8000-000000000002",
  "food-drinks.groceries": "c96a1000-0000-4000-8000-000000000003",
  "food-drinks.restaurant-fast-food": "c96a1000-0000-4000-8000-000000000004",
  shopping: "c96a1000-0000-4000-8000-000000000005",
  "shopping.clothes-shoes": "c96a1000-0000-4000-8000-000000000006",
  "shopping.drug-store-chemist": "c96a1000-0000-4000-8000-000000000007",
  "shopping.electronics-accessories": "c96a1000-0000-4000-8000-000000000008",
  "shopping.free-time": "c96a1000-0000-4000-8000-000000000009",
  "shopping.gifts-joy": "c96a1000-0000-4000-8000-000000000010",
  "shopping.health-beauty": "c96a1000-0000-4000-8000-000000000011",
  "shopping.home-garden": "c96a1000-0000-4000-8000-000000000012",
  "shopping.jewels-accessories": "c96a1000-0000-4000-8000-000000000013",
  "shopping.kids": "c96a1000-0000-4000-8000-000000000014",
  "shopping.pets-animals": "c96a1000-0000-4000-8000-000000000015",
  "shopping.stationery-tools": "c96a1000-0000-4000-8000-000000000016",
  housing: "c96a1000-0000-4000-8000-000000000017",
  "housing.energy-utilities": "c96a1000-0000-4000-8000-000000000018",
  "housing.maintenance-repairs": "c96a1000-0000-4000-8000-000000000019",
  "housing.mortgage": "c96a1000-0000-4000-8000-000000000020",
  "housing.property-insurance": "c96a1000-0000-4000-8000-000000000021",
  "housing.rent": "c96a1000-0000-4000-8000-000000000022",
  "housing.services": "c96a1000-0000-4000-8000-000000000023",
  transportation: "c96a1000-0000-4000-8000-000000000024",
  "transportation.business-trips": "c96a1000-0000-4000-8000-000000000025",
  "transportation.long-distance": "c96a1000-0000-4000-8000-000000000026",
  "transportation.public-transport": "c96a1000-0000-4000-8000-000000000027",
  "transportation.taxi": "c96a1000-0000-4000-8000-000000000028",
  vehicle: "c96a1000-0000-4000-8000-000000000029",
  "vehicle.fuel": "c96a1000-0000-4000-8000-000000000030",
  "vehicle.leasing": "c96a1000-0000-4000-8000-000000000031",
  "vehicle.parking": "c96a1000-0000-4000-8000-000000000032",
  "vehicle.rentals": "c96a1000-0000-4000-8000-000000000033",
  "vehicle.vehicle-insurance": "c96a1000-0000-4000-8000-000000000034",
  "vehicle.vehicle-maintenance": "c96a1000-0000-4000-8000-000000000035",
  "life-entertainment": "c96a1000-0000-4000-8000-000000000036",
  "life-entertainment.active-sport-fitness":
    "c96a1000-0000-4000-8000-000000000037",
  "life-entertainment.alcohol-tobacco": "c96a1000-0000-4000-8000-000000000038",
  "life-entertainment.books-audio-subscriptions":
    "c96a1000-0000-4000-8000-000000000039",
  "life-entertainment.charity-gifts": "c96a1000-0000-4000-8000-000000000040",
  "life-entertainment.culture-sport-events":
    "c96a1000-0000-4000-8000-000000000041",
  "life-entertainment.education-development":
    "c96a1000-0000-4000-8000-000000000042",
  "life-entertainment.health-care-doctor":
    "c96a1000-0000-4000-8000-000000000043",
  "life-entertainment.hobbies": "c96a1000-0000-4000-8000-000000000044",
  "life-entertainment.holiday-trips-hotels":
    "c96a1000-0000-4000-8000-000000000045",
  "life-entertainment.life-events": "c96a1000-0000-4000-8000-000000000046",
  "life-entertainment.lottery-gambling": "c96a1000-0000-4000-8000-000000000047",
  "life-entertainment.tv-streaming": "c96a1000-0000-4000-8000-000000000048",
  "life-entertainment.wellness-beauty": "c96a1000-0000-4000-8000-000000000049",
  "communication-pc": "c96a1000-0000-4000-8000-000000000050",
  "communication-pc.internet": "c96a1000-0000-4000-8000-000000000051",
  "communication-pc.phone-cell-phone": "c96a1000-0000-4000-8000-000000000052",
  "communication-pc.postal-services": "c96a1000-0000-4000-8000-000000000053",
  "communication-pc.software-apps-games":
    "c96a1000-0000-4000-8000-000000000054",
  "financial-expenses": "c96a1000-0000-4000-8000-000000000055",
  "financial-expenses.advisory": "c96a1000-0000-4000-8000-000000000056",
  "financial-expenses.charges-fees": "c96a1000-0000-4000-8000-000000000057",
  "financial-expenses.child-support": "c96a1000-0000-4000-8000-000000000058",
  "financial-expenses.fines": "c96a1000-0000-4000-8000-000000000059",
  "financial-expenses.insurances": "c96a1000-0000-4000-8000-000000000060",
  "financial-expenses.loan-interests": "c96a1000-0000-4000-8000-000000000061",
  "financial-expenses.taxes": "c96a1000-0000-4000-8000-000000000062",
  investments: "c96a1000-0000-4000-8000-000000000063",
  "investments.collections": "c96a1000-0000-4000-8000-000000000064",
  "investments.financial-investments": "c96a1000-0000-4000-8000-000000000065",
  "investments.realty": "c96a1000-0000-4000-8000-000000000066",
  "investments.savings": "c96a1000-0000-4000-8000-000000000067",
  "investments.vehicles-chattels": "c96a1000-0000-4000-8000-000000000068",
  income: "c96a1000-0000-4000-8000-000000000069",
  "income.checks-coupons": "c96a1000-0000-4000-8000-000000000070",
  "income.child-support": "c96a1000-0000-4000-8000-000000000071",
  "income.dues-grants": "c96a1000-0000-4000-8000-000000000072",
  "income.gifts": "c96a1000-0000-4000-8000-000000000073",
  "income.interests-dividends": "c96a1000-0000-4000-8000-000000000074",
  "income.lending-renting": "c96a1000-0000-4000-8000-000000000075",
  "income.lottery-gambling": "c96a1000-0000-4000-8000-000000000076",
  "income.refunds": "c96a1000-0000-4000-8000-000000000077",
  "income.rental-income": "c96a1000-0000-4000-8000-000000000078",
  "income.sale": "c96a1000-0000-4000-8000-000000000079",
  "income.wage-invoices": "c96a1000-0000-4000-8000-000000000080"
};

export type CatalogCategory = {
  id: string;
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
      id: catalogIds[group.key]!,
      key: group.key,
      parentKey: null,
      name: group.name,
      iconKey: iconPrefix(group.key),
      colorKey: "neutral",
      sortOrder: (index + 1) * 10
    },
    ...group.children.map(([key, name], childIndex) => ({
      id: catalogIds[`${group.key}.${key}`]!,
      key: `${group.key}.${key}`,
      parentKey: group.key,
      name,
      iconKey: `${iconPrefix(group.key)}-${key}`,
      colorKey: "neutral",
      sortOrder: (childIndex + 1) * 10
    }))
  ])
};
