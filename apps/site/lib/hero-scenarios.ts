// Editorial examples for the homepage demo. They mirror the shape of the
// interactive answers OvertChat renders, and every figure is computed here
// instead of typed in, so a follow-up always shows numbers that add up.

export interface ChartPoint {
  label: string;
  value: number;
  /** Text shown in the hover readout. */
  detail: string;
}

export interface HeroFollowUp {
  label: string;
  next: string;
}

export type HeroBlock =
  | { kind: "header"; title: string; subtitle: string }
  | {
      kind: "metrics";
      items: Array<{ label: string; value: number; note: string }>;
    }
  | { kind: "line"; unit: string; summary: string; points: ChartPoint[] }
  | { kind: "bars"; unit: string; summary: string; points: ChartPoint[] }
  | {
      kind: "dishes";
      items: Array<{ title: string; course: string; time: string }>;
    }
  | {
      kind: "checklist";
      title: string;
      groups: Array<{ label: string; items: string[] }>;
    }
  | {
      kind: "table";
      title: string;
      rows: Array<{ day: string; session: string; distance: string }>;
    }
  | { kind: "followups"; items: HeroFollowUp[] };

export interface HeroScenario {
  id: string;
  /** The sidebar conversation this turn belongs to. */
  chatId: HeroChatId;
  prompt: string;
  tool?: { running: string; done: string };
  blocks: HeroBlock[];
}

export const HERO_CHATS = [
  { id: "savings", title: "What $400 a month becomes", tab: "Savings chart" },
  { id: "dinner", title: "Dinner for six", tab: "Dinner checklist" },
  { id: "training", title: "First 10K in six weeks", tab: "Training plan" },
] as const;

export type HeroChatId = (typeof HERO_CHATS)[number]["id"];

const ANNUAL_RATE = 0.07;
const MONTHLY_RATE = ANNUAL_RATE / 12;
const GOAL = 1_000_000;

/** Balance after `years` of monthly deposits at 7% a year, compounded monthly. */
export function projectBalance(
  monthly: number,
  start: number,
  years: number,
): number {
  const growth = (1 + MONTHLY_RATE) ** (years * 12);
  return start * growth + monthly * ((growth - 1) / MONTHLY_RATE);
}

/** Smallest monthly deposit, in whole tens, that reaches the goal in 30 years. */
export function monthlyForGoal(start: number, goal = GOAL): number {
  const growth = (1 + MONTHLY_RATE) ** 360;
  const exact = (goal - start * growth) / ((growth - 1) / MONTHLY_RATE);
  return Math.ceil(exact / 10) * 10;
}

export function formatDollars(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function roundToHundred(value: number): number {
  return Math.round(value / 100) * 100;
}

type SavingsPlan = { monthly: number; start: number; goal: boolean };

function savingsId({ monthly, start }: SavingsPlan): string {
  return `savings-${monthly}-${start}`;
}

const BASE_PLAN: SavingsPlan = { monthly: 400, start: 0, goal: false };
const HEAD_START_PLAN: SavingsPlan = { monthly: 400, start: 5000, goal: false };
const GOAL_PLAN: SavingsPlan = {
  monthly: monthlyForGoal(0),
  start: 0,
  goal: true,
};
const GOAL_HEAD_START_PLAN: SavingsPlan = {
  monthly: monthlyForGoal(5000),
  start: 5000,
  goal: true,
};

function savingsScenario(
  plan: SavingsPlan,
  prompt: string,
  followUps: HeroFollowUp[],
): HeroScenario {
  const { monthly, start, goal } = plan;
  const monthlyText = formatDollars(monthly);
  const title = goal
    ? `${monthlyText} a month reaches $1M`
    : `${monthlyText} a month at 7% a year`;
  const opening = start
    ? `Starting with ${formatDollars(start)} saved, at`
    : "An illustration at";

  return {
    id: savingsId(plan),
    chatId: "savings",
    prompt,
    blocks: [
      {
        kind: "header",
        title,
        subtitle: `${opening} a steady 7% a year, compounded monthly, before taxes, fees and inflation`,
      },
      {
        kind: "metrics",
        items: [10, 20, 30].map((years) => ({
          label: `After ${years} years`,
          value: roundToHundred(projectBalance(monthly, start, years)),
          note: `${formatDollars(start + monthly * 12 * years)} contributed`,
        })),
      },
      {
        kind: "line",
        unit: "Thousands of dollars",
        summary: `Balance grows from ${formatDollars(start)} to about ${formatDollars(
          roundToHundred(projectBalance(monthly, start, 30)),
        )} over 30 years.`,
        points: [0, 5, 10, 15, 20, 25, 30].map((years) => {
          const balance = projectBalance(monthly, start, years);
          return {
            label: years === 0 ? "Start" : `${years} yrs`,
            value: Math.round(balance / 100) / 10,
            detail: formatDollars(roundToHundred(balance)),
          };
        }),
      },
      { kind: "followups", items: followUps },
    ],
  };
}

const HEAD_START_QUESTION = "What if I start with $5,000 already saved?";
const GOAL_QUESTION = "How much a month reaches $1M in 30 years?";
const FROM_ZERO_QUESTION = "What if I start from zero instead?";
const BACK_TO_400_QUESTION = "Where does $400 a month land again?";

const savings = [
  savingsScenario(
    BASE_PLAN,
    "If I put $400 a month into an index fund, what does it look like after 10, 20 and 30 years? Assume 7% a year.",
    [
      { label: HEAD_START_QUESTION, next: savingsId(HEAD_START_PLAN) },
      { label: GOAL_QUESTION, next: savingsId(GOAL_PLAN) },
    ],
  ),
  savingsScenario(HEAD_START_PLAN, HEAD_START_QUESTION, [
    { label: GOAL_QUESTION, next: savingsId(GOAL_HEAD_START_PLAN) },
    { label: FROM_ZERO_QUESTION, next: savingsId(BASE_PLAN) },
  ]),
  savingsScenario(GOAL_PLAN, GOAL_QUESTION, [
    { label: HEAD_START_QUESTION, next: savingsId(GOAL_HEAD_START_PLAN) },
    { label: BACK_TO_400_QUESTION, next: savingsId(BASE_PLAN) },
  ]),
  savingsScenario(GOAL_HEAD_START_PLAN, HEAD_START_QUESTION, [
    { label: FROM_ZERO_QUESTION, next: savingsId(GOAL_PLAN) },
    { label: BACK_TO_400_QUESTION, next: savingsId(HEAD_START_PLAN) },
  ]),
];

// Quantities for six people; `scale` rounds each one up to what a shop sells.
const SHOPPING: Array<{
  aisle: string;
  items: Array<{ name: string; amount: number; unit: string; step: number }>;
}> = [
  {
    aisle: "Produce",
    items: [
      { name: "Cherry tomatoes", amount: 900, unit: "g", step: 50 },
      { name: "Arugula", amount: 2, unit: "bags", step: 1 },
      { name: "Lemons", amount: 2, unit: "", step: 1 },
      { name: "Mixed berries", amount: 500, unit: "g", step: 50 },
    ],
  },
  {
    aisle: "Pantry and bakery",
    items: [
      { name: "Chickpeas", amount: 2, unit: "cans", step: 1 },
      { name: "Pasta", amount: 600, unit: "g", step: 50 },
      { name: "Rolled oats", amount: 150, unit: "g", step: 50 },
      { name: "Garlic bread", amount: 2, unit: "loaves", step: 1 },
    ],
  },
];

function scaledAmount(
  item: (typeof SHOPPING)[number]["items"][number],
  people: number,
): string {
  const scaled = Math.ceil((item.amount * people) / 6 / item.step) * item.step;
  if (item.unit === "g") {
    return scaled >= 1000 ? `${scaled / 1000} kg` : `${scaled} g`;
  }
  return item.unit ? `${scaled} ${item.unit}` : String(scaled);
}

function dinnerScenario(
  id: string,
  people: number,
  prompt: string,
  followUps: HeroFollowUp[],
  searched: boolean,
): HeroScenario {
  const count = people === 6 ? "six" : "ten";
  return {
    id,
    chatId: "dinner",
    prompt,
    ...(searched
      ? { tool: { running: "Searching the web", done: "Searched 4 recipes" } }
      : {}),
    blocks: [
      {
        kind: "header",
        title: `Vegetarian dinner for ${count}`,
        subtitle:
          "A low-stress menu everyone can share, about 75 minutes from start to table",
      },
      {
        kind: "dishes",
        items: [
          { title: "Roasted tomato and chickpea pasta", course: "Main", time: "40 min" },
          { title: "Arugula salad with lemon dressing", course: "Side", time: "10 min" },
          { title: "Garlic bread and berry crumble", course: "To share", time: "25 min" },
        ],
      },
      {
        kind: "checklist",
        title: "Shopping list",
        groups: SHOPPING.map((group) => ({
          label: group.aisle,
          items: group.items.map(
            (item) => `${item.name} · ${scaledAmount(item, people)}`,
          ),
        })),
      },
      { kind: "followups", items: followUps },
    ],
  };
}

const dinner = [
  dinnerScenario(
    "dinner-6",
    6,
    "Plan a vegetarian dinner for six and make a shopping list.",
    [{ label: "Scale it to ten people", next: "dinner-10" }],
    true,
  ),
  dinnerScenario(
    "dinner-10",
    10,
    "Scale it to ten people",
    [{ label: "Take it back down to six", next: "dinner-6" }],
    false,
  ),
];

const WEEK_ONE = [
  { day: "Tue", session: "Easy run", km: 3 },
  { day: "Thu", session: "Intervals", km: 4 },
  { day: "Sun", session: "Long run", km: 5 },
];
const WEEKLY_GROWTH = [1, 1.2, 1.4, 1.7, 1.9, 1.3];

function trainingScenario(
  id: string,
  days: 3 | 4,
  prompt: string,
  followUps: HeroFollowUp[],
): HeroScenario {
  const week =
    days === 4
      ? [...WEEK_ONE.slice(0, 2), { day: "Sat", session: "Recovery jog", km: 3 }, WEEK_ONE[2]]
      : WEEK_ONE;
  const base = week.reduce((total, run) => total + run.km, 0);
  const distances = WEEKLY_GROWTH.map((factor) => Math.round(base * factor));

  return {
    id,
    chatId: "training",
    prompt,
    blocks: [
      {
        kind: "header",
        title: "Six weeks to your first 10K",
        subtitle: `${days === 4 ? "Four" : "Three"} runs a week, building gradually, with an easier final week before race day`,
      },
      {
        kind: "bars",
        unit: "Kilometres per week",
        summary: `Weekly distance builds from ${distances[0]} km to ${Math.max(...distances)} km, then eases to ${distances[5]} km in race week.`,
        points: distances.map((km, index) => ({
          label: `Wk ${index + 1}`,
          value: km,
          detail: index === 5 ? `${km} km · race week` : `${km} km`,
        })),
      },
      {
        kind: "table",
        title: "Week one",
        rows: week.map((run) => ({
          day: run.day,
          session: run.session,
          distance: `${run.km} km`,
        })),
      },
      { kind: "followups", items: followUps },
    ],
  };
}

const training = [
  trainingScenario(
    "training-3",
    3,
    "Build me a six-week plan to run my first 10K. I can train three days a week.",
    [{ label: "Add a fourth day of training", next: "training-4" }],
  ),
  trainingScenario("training-4", 4, "Add a fourth day of training", [
    { label: "Go back to three days", next: "training-3" },
  ]),
];

export const HERO_SCENARIOS: Record<string, HeroScenario> = Object.fromEntries(
  [...savings, ...dinner, ...training].map((scenario) => [scenario.id, scenario]),
);

/** The turn each sidebar conversation opens on. */
export const HERO_CHAT_START: Record<HeroChatId, string> = {
  savings: savingsId(BASE_PLAN),
  dinner: "dinner-6",
  training: "training-3",
};

/** Evenly spaced axis ticks from zero up to the largest value. */
export function axisTicks(max: number): number[] {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  const step = steps.find((candidate) => max / candidate <= 3.2) ?? 1000;
  const ticks: number[] = [];
  for (let tick = 0; tick <= max; tick += step) ticks.push(tick);
  return ticks;
}
