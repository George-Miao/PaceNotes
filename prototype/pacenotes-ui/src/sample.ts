export type DayId = "day-1" | "day-2" | "day-3" | "day-4" | "day-5";

export type PlaceKind =
  | "food"
  | "lodging"
  | "sight"
  | "shop"
  | "transport"
  | "walk";

export type TripDay = {
  id: DayId;
  date: string;
  shortDate: string;
  weekday: string;
  city: string;
  title: string;
  summary: string;
  weather: string;
  itemIds: string[];
};

export type Reservation = {
  state: "confirmed" | "needed";
  time: string;
  code?: string;
  party?: number;
  note: string;
};

export type Transport = {
  mode: "walk" | "metro" | "train" | "bus" | "taxi";
  line?: string;
  from: string;
  to: string;
  departure?: string;
  arrival?: string;
  durationMinutes: number;
  platform?: string;
};

export type Lodging = {
  checkIn: string;
  checkOut: string;
  address: string;
  room: string;
};

export type TripItem = {
  id: string;
  dayId: DayId;
  kind: PlaceKind;
  title: string;
  subtitle: string;
  area: string;
  start?: string;
  end?: string;
  isUntimed: boolean;
  coordinates: [number, number];
  status: "fixed" | "flexible" | "needs-review";
  note: string;
  tags: string[];
  reservation?: Reservation;
  transport?: Transport;
  lodging?: Lodging;
};

export type Candidate = {
  id: string;
  dayId: DayId;
  title: string;
  kind: PlaceKind;
  area: string;
  coordinates: [number, number];
  reason: string;
  travelMinutes: number;
  rating: string;
  price: "$" | "$$" | "$$$";
};

export type Editor = {
  id: string;
  name: string;
  initials: string;
  color: "cobalt" | "persimmon" | "moss";
  status: "editing" | "viewing";
  lastAction: string;
};

export type RouteSegment = {
  id: string;
  dayId: DayId;
  from: string;
  to: string;
  mode: Transport["mode"];
  durationMinutes: number;
  state: "ready" | "tight" | "unmatched";
  path: [number, number][];
};

export type TripRoute = {
  status: "needs-review";
  summary: string;
  totalDistanceKm: number;
  totalTravelMinutes: number;
  updatedAt: string;
  unmatchedItemIds: string[];
  segments: RouteSegment[];
};

export type SampleTrip = {
  title: string;
  dateRange: string;
  activeDay: DayId;
  days: TripDay[];
  items: TripItem[];
  candidates: Candidate[];
  editors: Editor[];
  route: TripRoute;
};

export const sampleTrip: SampleTrip = {
  title: "Japan spring route",
  dateRange: "12-16 May 2026",
  activeDay: "day-3",
  days: [
    {
      id: "day-1",
      date: "2026-05-12",
      shortDate: "12 May",
      weekday: "Tue",
      city: "Tokyo",
      title: "Yanaka to Shibuya",
      summary: "Old streets, food, and a late city view",
      weather: "21 C - light rain",
      itemIds: ["tokyo-station", "sawanoya", "yanaka", "nezu", "shibuya-sky", "toritake"],
    },
    {
      id: "day-2",
      date: "2026-05-13",
      shortDate: "13 May",
      weekday: "Wed",
      city: "Tokyo",
      title: "Market and east Tokyo",
      summary: "Sushi, a river walk, and tools in Kappabashi",
      weather: "23 C - clear",
      itemIds: ["tsukiji", "hamarikyu", "asakusa-line", "kappabashi", "sensoji", "sawanoya-return"],
    },
    {
      id: "day-3",
      date: "2026-05-14",
      shortDate: "14 May",
      weekday: "Thu",
      city: "Hakone",
      title: "Tokyo to Hakone",
      summary: "Mountain rail, open-air art, and an onsen stay",
      weather: "18 C - cloud",
      itemIds: ["romancecar", "hakone-yuryo", "tozan", "open-air", "yama-no-chaya"],
    },
    {
      id: "day-4",
      date: "2026-05-15",
      shortDate: "15 May",
      weekday: "Fri",
      city: "Kyoto",
      title: "Hakone to Kyoto",
      summary: "Lake transfer, Shinkansen, and a quiet temple walk",
      weather: "24 C - clear",
      itemIds: ["odawara-bus", "hikari", "the-gate", "nishiki", "shoseien", "gion-karyo"],
    },
    {
      id: "day-5",
      date: "2026-05-16",
      shortDate: "16 May",
      weekday: "Sat",
      city: "Kyoto",
      title: "North Kyoto by bike",
      summary: "Early shrine paths, gardens, and a final dinner",
      weather: "25 C - sun",
      itemIds: ["fushimi", "cycle", "demachi", "ginkakuji", "en", "kyoto-station-depart"],
    },
  ],
  items: [
    {
      id: "tokyo-station",
      dayId: "day-1",
      kind: "transport",
      title: "Arrive at Tokyo Station",
      subtitle: "Narita Express 8",
      area: "Marunouchi",
      start: "10:18",
      end: "10:30",
      isUntimed: false,
      coordinates: [139.7671, 35.6812],
      status: "fixed",
      note: "Use the Marunouchi north exit.",
      tags: ["ticket saved", "2 bags"],
      transport: {
        mode: "train",
        line: "Narita Express 8",
        from: "Narita Airport Terminal 1",
        to: "Tokyo Station",
        departure: "09:14",
        arrival: "10:18",
        durationMinutes: 64,
        platform: "B5",
      },
    },
    {
      id: "sawanoya",
      dayId: "day-1",
      kind: "lodging",
      title: "Sawanoya Ryokan",
      subtitle: "Leave bags before check-in",
      area: "Yanaka",
      start: "11:15",
      end: "11:35",
      isUntimed: false,
      coordinates: [139.766, 35.7224],
      status: "fixed",
      note: "The room is ready after 15:00.",
      tags: ["cash at desk", "quiet room"],
      lodging: {
        checkIn: "15:00",
        checkOut: "10:00 on 14 May",
        address: "2-3-11 Yanaka, Taito City",
        room: "Japanese room 6 tatami",
      },
    },
    {
      id: "yanaka",
      dayId: "day-1",
      kind: "walk",
      title: "Yanaka Ginza walk",
      subtitle: "Start at Yuyake Dandan steps",
      area: "Yanaka",
      start: "12:00",
      end: "13:20",
      isUntimed: false,
      coordinates: [139.7668, 35.7273],
      status: "flexible",
      note: "Try the chestnut shop if the line is short.",
      tags: ["street food", "outdoor"],
    },
    {
      id: "nezu",
      dayId: "day-1",
      kind: "sight",
      title: "Nezu Shrine",
      subtitle: "Azalea path and torii gates",
      area: "Nezu",
      isUntimed: true,
      coordinates: [139.7601, 35.7202],
      status: "flexible",
      note: "Place before 16:30. The grounds close at 17:00.",
      tags: ["free", "45 min"],
    },
    {
      id: "shibuya-sky",
      dayId: "day-1",
      kind: "sight",
      title: "Shibuya Sky",
      subtitle: "Sunset entry",
      area: "Shibuya",
      start: "18:20",
      end: "19:40",
      isUntimed: false,
      coordinates: [139.702, 35.6584],
      status: "fixed",
      note: "Large bags must go in a locker.",
      tags: ["booked", "sunset"],
      reservation: {
        state: "confirmed",
        time: "18:20",
        code: "SS-5148",
        party: 2,
        note: "Show the QR ticket at level 14.",
      },
    },
    {
      id: "toritake",
      dayId: "day-1",
      kind: "food",
      title: "Toritake",
      subtitle: "Yakitori dinner",
      area: "Shibuya",
      isUntimed: true,
      coordinates: [139.6995, 35.6592],
      status: "needs-review",
      note: "No booking. Use Uobei as the backup.",
      tags: ["queue", "cash"],
    },
    {
      id: "tsukiji",
      dayId: "day-2",
      kind: "food",
      title: "Tsukiji outer market",
      subtitle: "Breakfast loop",
      area: "Tsukiji",
      start: "07:30",
      end: "09:15",
      isUntimed: false,
      coordinates: [139.7708, 35.6655],
      status: "flexible",
      note: "Start at the east gate. Avoid the central lane at 09:00.",
      tags: ["early", "snacks"],
    },
    {
      id: "hamarikyu",
      dayId: "day-2",
      kind: "sight",
      title: "Hamarikyu Gardens",
      subtitle: "Tea house by the pond",
      area: "Shiodome",
      start: "09:30",
      end: "11:00",
      isUntimed: false,
      coordinates: [139.763, 35.6597],
      status: "flexible",
      note: "Buy the combined garden and tea ticket.",
      tags: ["garden", "tea"],
    },
    {
      id: "asakusa-line",
      dayId: "day-2",
      kind: "transport",
      title: "Metro to Tawaramachi",
      subtitle: "Asakusa Line and Ginza Line",
      area: "Shiodome",
      start: "11:12",
      end: "11:38",
      isUntimed: false,
      coordinates: [139.7598, 35.6628],
      status: "fixed",
      note: "Change at Shimbashi. Use exit 3 at Tawaramachi.",
      tags: ["1 change", "IC card"],
      transport: {
        mode: "metro",
        line: "Asakusa Line and Ginza Line",
        from: "Shiodome",
        to: "Tawaramachi",
        departure: "11:12",
        arrival: "11:38",
        durationMinutes: 26,
      },
    },
    {
      id: "kappabashi",
      dayId: "day-2",
      kind: "shop",
      title: "Kappabashi tool street",
      subtitle: "Knives and small kitchen tools",
      area: "Taito",
      isUntimed: true,
      coordinates: [139.7888, 35.7147],
      status: "flexible",
      note: "Compare Kama-Asa and Tsubaya before buying.",
      tags: ["shopping", "90 min"],
    },
    {
      id: "sensoji",
      dayId: "day-2",
      kind: "sight",
      title: "Senso-ji after dusk",
      subtitle: "Main hall and lit gate",
      area: "Asakusa",
      start: "18:30",
      end: "19:20",
      isUntimed: false,
      coordinates: [139.7967, 35.7148],
      status: "flexible",
      note: "The main hall closes before the grounds.",
      tags: ["night", "free"],
    },
    {
      id: "sawanoya-return",
      dayId: "day-2",
      kind: "lodging",
      title: "Sawanoya Ryokan",
      subtitle: "Second night",
      area: "Yanaka",
      start: "20:10",
      isUntimed: false,
      coordinates: [139.766, 35.7224],
      status: "fixed",
      note: "Reserve the family bath at the desk.",
      tags: ["booked", "bath"],
      lodging: {
        checkIn: "complete",
        checkOut: "10:00 on 14 May",
        address: "2-3-11 Yanaka, Taito City",
        room: "Japanese room 6 tatami",
      },
    },
    {
      id: "romancecar",
      dayId: "day-3",
      kind: "transport",
      title: "Romancecar to Hakone",
      subtitle: "GSE 3 from Shinjuku",
      area: "Shinjuku",
      start: "08:00",
      end: "09:27",
      isUntimed: false,
      coordinates: [139.7006, 35.6896],
      status: "fixed",
      note: "Car 5, seats 8A and 8B. Buy breakfast first.",
      tags: ["reserved", "window"],
      reservation: {
        state: "confirmed",
        time: "08:00",
        code: "ODQ-84K2",
        party: 2,
        note: "Board at platform 2.",
      },
      transport: {
        mode: "train",
        line: "Odakyu Romancecar GSE 3",
        from: "Shinjuku",
        to: "Hakone-Yumoto",
        departure: "08:00",
        arrival: "09:27",
        durationMinutes: 87,
        platform: "2",
      },
    },
    {
      id: "hakone-yuryo",
      dayId: "day-3",
      kind: "food",
      title: "Hatsuhana Soba",
      subtitle: "Early lunch near the river",
      area: "Hakone-Yumoto",
      start: "10:10",
      end: "11:00",
      isUntimed: false,
      coordinates: [139.1038, 35.2329],
      status: "flexible",
      note: "Order grated yam soba. The second shop is less busy.",
      tags: ["soba", "no booking"],
    },
    {
      id: "tozan",
      dayId: "day-3",
      kind: "transport",
      title: "Hakone Tozan Railway",
      subtitle: "Switchback train to Chokoku-no-Mori",
      area: "Hakone-Yumoto",
      start: "11:18",
      end: "11:54",
      isUntimed: false,
      coordinates: [139.1037, 35.2334],
      status: "fixed",
      note: "Sit on the left for valley views.",
      tags: ["local train", "3 switchbacks"],
      transport: {
        mode: "train",
        line: "Hakone Tozan Railway",
        from: "Hakone-Yumoto",
        to: "Chokoku-no-Mori",
        departure: "11:18",
        arrival: "11:54",
        durationMinutes: 36,
      },
    },
    {
      id: "open-air",
      dayId: "day-3",
      kind: "sight",
      title: "Hakone Open-Air Museum",
      subtitle: "Sculpture park and Picasso hall",
      area: "Ninotaira",
      start: "12:00",
      end: "15:20",
      isUntimed: false,
      coordinates: [139.0509, 35.2448],
      status: "flexible",
      note: "Leave 20 minutes for the foot bath.",
      tags: ["museum", "outdoor"],
    },
    {
      id: "yama-no-chaya",
      dayId: "day-3",
      kind: "lodging",
      title: "Yama no Chaya",
      subtitle: "Ryokan check-in and kaiseki",
      area: "Tonosawa",
      start: "16:00",
      end: "20:30",
      isUntimed: false,
      coordinates: [139.0932, 35.2391],
      status: "fixed",
      note: "Private bath is set for 17:30. Dinner starts at 18:30.",
      tags: ["half board", "onsen"],
      reservation: {
        state: "confirmed",
        time: "16:00",
        code: "YNC-09241",
        party: 2,
        note: "Call if arrival is after 17:00.",
      },
      lodging: {
        checkIn: "15:00",
        checkOut: "10:00 on 15 May",
        address: "171 Tonosawa, Hakone",
        room: "Kaede room with outdoor bath",
      },
    },
    {
      id: "odawara-bus",
      dayId: "day-4",
      kind: "transport",
      title: "Bus to Odawara",
      subtitle: "Direct transfer from Tonosawa",
      area: "Tonosawa",
      start: "09:12",
      end: "09:44",
      isUntimed: false,
      coordinates: [139.094, 35.2396],
      status: "fixed",
      note: "Allow 12 minutes to reach the Shinkansen gate.",
      tags: ["IC card", "front door exit"],
      transport: {
        mode: "bus",
        line: "Hakone Tozan Bus H",
        from: "Kami-Tonosawa",
        to: "Odawara Station",
        departure: "09:12",
        arrival: "09:44",
        durationMinutes: 32,
      },
    },
    {
      id: "hikari",
      dayId: "day-4",
      kind: "transport",
      title: "Hikari 635 to Kyoto",
      subtitle: "Tokaido Shinkansen",
      area: "Odawara",
      start: "10:07",
      end: "12:12",
      isUntimed: false,
      coordinates: [139.1557, 35.2564],
      status: "fixed",
      note: "Car 6, seats 12D and 12E. Buy lunch at the gate.",
      tags: ["reserved", "right side view"],
      reservation: {
        state: "confirmed",
        time: "10:07",
        code: "EX-635-12DE",
        party: 2,
        note: "Use the smart ticket on the IC cards.",
      },
      transport: {
        mode: "train",
        line: "Tokaido Shinkansen Hikari 635",
        from: "Odawara",
        to: "Kyoto",
        departure: "10:07",
        arrival: "12:12",
        durationMinutes: 125,
        platform: "13",
      },
    },
    {
      id: "the-gate",
      dayId: "day-4",
      kind: "lodging",
      title: "The Gate Hotel Kyoto",
      subtitle: "Bag drop and check-in",
      area: "Takasegawa",
      start: "12:45",
      end: "13:10",
      isUntimed: false,
      coordinates: [135.7684, 35.0087],
      status: "fixed",
      note: "Ask for the room away from the lift.",
      tags: ["booked", "breakfast included"],
      lodging: {
        checkIn: "14:00",
        checkOut: "11:00 on 17 May",
        address: "310-2 Bizenjimacho, Nakagyo Ward",
        room: "Essential twin",
      },
    },
    {
      id: "nishiki",
      dayId: "day-4",
      kind: "food",
      title: "Nishiki Market lunch",
      subtitle: "Small bites from west to east",
      area: "Nakagyo",
      isUntimed: true,
      coordinates: [135.7649, 35.005],
      status: "flexible",
      note: "Do not eat while walking. Stop at each shop.",
      tags: ["market", "45 min"],
    },
    {
      id: "shoseien",
      dayId: "day-4",
      kind: "sight",
      title: "Shosei-en Garden",
      subtitle: "Late light around Ingetsu Pond",
      area: "Shimogyo",
      start: "15:10",
      end: "16:35",
      isUntimed: false,
      coordinates: [135.7652, 34.9949],
      status: "flexible",
      note: "Last entry is 16:30.",
      tags: ["garden", "quiet"],
    },
    {
      id: "gion-karyo",
      dayId: "day-4",
      kind: "food",
      title: "Gion Karyo",
      subtitle: "Seasonal kaiseki dinner",
      area: "Gion",
      start: "19:00",
      end: "21:00",
      isUntimed: false,
      coordinates: [135.7759, 35.0012],
      status: "needs-review",
      note: "Reservation request sent. Confirm by 10 May.",
      tags: ["formal", "pending"],
      reservation: {
        state: "needed",
        time: "19:00",
        party: 2,
        note: "No shellfish for Mina.",
      },
    },
    {
      id: "fushimi",
      dayId: "day-5",
      kind: "sight",
      title: "Fushimi Inari climb",
      subtitle: "Upper path before the main crowds",
      area: "Fushimi",
      start: "06:20",
      end: "09:10",
      isUntimed: false,
      coordinates: [135.7727, 34.9671],
      status: "fixed",
      note: "Take water. Turn back at Mitsutsuji if rain starts.",
      tags: ["early", "hike"],
    },
    {
      id: "cycle",
      dayId: "day-5",
      kind: "transport",
      title: "Pick up rental bikes",
      subtitle: "Two city bikes with baskets",
      area: "Demachiyanagi",
      start: "10:10",
      end: "10:25",
      isUntimed: false,
      coordinates: [135.7726, 35.0297],
      status: "fixed",
      note: "Bring passports and the booking email.",
      tags: ["reserved", "return by 18:00"],
      reservation: {
        state: "confirmed",
        time: "10:10",
        code: "KCT-1620",
        party: 2,
        note: "Helmets are included.",
      },
      transport: {
        mode: "train",
        line: "Keihan Main Line",
        from: "Fushimi-Inari",
        to: "Demachiyanagi",
        departure: "09:28",
        arrival: "09:45",
        durationMinutes: 17,
      },
    },
    {
      id: "demachi",
      dayId: "day-5",
      kind: "food",
      title: "Demachi Futaba",
      subtitle: "Bean mochi stop",
      area: "Demachi",
      isUntimed: true,
      coordinates: [135.7698, 35.0302],
      status: "flexible",
      note: "Skip if the wait is over 25 minutes.",
      tags: ["snack", "queue"],
    },
    {
      id: "ginkakuji",
      dayId: "day-5",
      kind: "sight",
      title: "Ginkaku-ji",
      subtitle: "Silver Pavilion and sand garden",
      area: "Higashiyama",
      start: "11:20",
      end: "12:40",
      isUntimed: false,
      coordinates: [135.7982, 35.027],
      status: "flexible",
      note: "Park bikes at the public lot south of the gate.",
      tags: ["garden", "ticket"],
    },
    {
      id: "en",
      dayId: "day-5",
      kind: "food",
      title: "Monk",
      subtitle: "Wood-fired tasting menu",
      area: "Philosopher's Path",
      start: "18:30",
      end: "21:00",
      isUntimed: false,
      coordinates: [135.7954, 35.0186],
      status: "fixed",
      note: "The meal starts for all guests at the same time.",
      tags: ["booked", "tasting menu"],
      reservation: {
        state: "confirmed",
        time: "18:30",
        code: "MONK-516-MY",
        party: 2,
        note: "Arrive 10 minutes early.",
      },
    },
    {
      id: "kyoto-station-depart",
      dayId: "day-5",
      kind: "transport",
      title: "Send bags to Kansai Airport",
      subtitle: "Hotel desk courier cutoff",
      area: "Takasegawa",
      start: "08:00",
      end: "08:10",
      isUntimed: false,
      coordinates: [135.7684, 35.0087],
      status: "needs-review",
      note: "Ask the desk to confirm next-day delivery.",
      tags: ["bags", "confirm"],
    },
  ],
  candidates: [
    {
      id: "candidate-okonomiyaki",
      dayId: "day-1",
      title: "Okonomiyaki Mura",
      kind: "food",
      area: "Shibuya",
      coordinates: [139.7014, 35.6598],
      reason: "Short wait and close to the evening route",
      travelMinutes: 6,
      rating: "4.4",
      price: "$$",
    },
    {
      id: "candidate-teien",
      dayId: "day-2",
      title: "Tokyo Metropolitan Teien Art Museum",
      kind: "sight",
      area: "Shirokanedai",
      coordinates: [139.7192, 35.637],
      reason: "Strong indoor option if rain starts",
      travelMinutes: 28,
      rating: "4.3",
      price: "$$",
    },
    {
      id: "candidate-polamuseum",
      dayId: "day-3",
      title: "Pola Museum of Art",
      kind: "sight",
      area: "Sengokuhara",
      coordinates: [139.0248, 35.2569],
      reason: "Good rain option with a forest trail",
      travelMinutes: 31,
      rating: "4.5",
      price: "$$$",
    },
    {
      id: "candidate-udon",
      dayId: "day-4",
      title: "Yamamoto Menzou",
      kind: "food",
      area: "Okazaki",
      coordinates: [135.7814, 35.018],
      reason: "Useful lunch if the market is too busy",
      travelMinutes: 19,
      rating: "4.6",
      price: "$$",
    },
    {
      id: "candidate-murin-an",
      dayId: "day-5",
      title: "Murin-an",
      kind: "sight",
      area: "Okazaki",
      coordinates: [135.7895, 35.011],
      reason: "Fits between the bike route and dinner",
      travelMinutes: 11,
      rating: "4.7",
      price: "$",
    },
  ],
  editors: [
    {
      id: "editor-mina",
      name: "Mina Park",
      initials: "MP",
      color: "cobalt",
      status: "editing",
      lastAction: "Moves the Hakone museum stop",
    },
    {
      id: "editor-eli",
      name: "Eli Hart",
      initials: "EH",
      color: "persimmon",
      status: "editing",
      lastAction: "Checks the Kyoto dinner",
    },
    {
      id: "editor-jun",
      name: "Jun Sato",
      initials: "JS",
      color: "moss",
      status: "viewing",
      lastAction: "Views day 3",
    },
  ],
  route: {
    status: "needs-review",
    summary: "2 tight transfers and 1 unmatched stop",
    totalDistanceKm: 728.4,
    totalTravelMinutes: 573,
    updatedAt: "2 min ago",
    unmatchedItemIds: ["kyoto-station-depart"],
    segments: [
      {
        id: "route-1",
        dayId: "day-1",
        from: "Tokyo Station",
        to: "Sawanoya Ryokan",
        mode: "metro",
        durationMinutes: 33,
        state: "ready",
        path: [[139.7671, 35.6812], [139.7669, 35.7002], [139.766, 35.7224]],
      },
      {
        id: "route-2",
        dayId: "day-1",
        from: "Nezu Shrine",
        to: "Shibuya Sky",
        mode: "metro",
        durationMinutes: 38,
        state: "tight",
        path: [[139.7601, 35.7202], [139.7304, 35.6901], [139.702, 35.6584]],
      },
      {
        id: "route-3",
        dayId: "day-2",
        from: "Tsukiji outer market",
        to: "Hamarikyu Gardens",
        mode: "walk",
        durationMinutes: 14,
        state: "ready",
        path: [[139.7708, 35.6655], [139.7664, 35.6622], [139.763, 35.6597]],
      },
      {
        id: "route-4",
        dayId: "day-2",
        from: "Kappabashi tool street",
        to: "Senso-ji",
        mode: "walk",
        durationMinutes: 12,
        state: "ready",
        path: [[139.7888, 35.7147], [139.7928, 35.7149], [139.7967, 35.7148]],
      },
      {
        id: "route-5",
        dayId: "day-3",
        from: "Shinjuku",
        to: "Hakone-Yumoto",
        mode: "train",
        durationMinutes: 87,
        state: "ready",
        path: [[139.7006, 35.6896], [139.4401, 35.521], [139.1037, 35.2334]],
      },
      {
        id: "route-6",
        dayId: "day-3",
        from: "Open-Air Museum",
        to: "Yama no Chaya",
        mode: "taxi",
        durationMinutes: 18,
        state: "tight",
        path: [[139.0509, 35.2448], [139.0712, 35.2421], [139.0932, 35.2391]],
      },
      {
        id: "route-7",
        dayId: "day-4",
        from: "Odawara Station",
        to: "Kyoto Station",
        mode: "train",
        durationMinutes: 125,
        state: "ready",
        path: [[139.1557, 35.2564], [137.8901, 35.1022], [135.7588, 34.9858]],
      },
      {
        id: "route-8",
        dayId: "day-4",
        from: "Shosei-en Garden",
        to: "Gion Karyo",
        mode: "taxi",
        durationMinutes: 13,
        state: "ready",
        path: [[135.7652, 34.9949], [135.7712, 34.9981], [135.7759, 35.0012]],
      },
      {
        id: "route-9",
        dayId: "day-5",
        from: "Demachiyanagi",
        to: "Ginkaku-ji",
        mode: "walk",
        durationMinutes: 21,
        state: "ready",
        path: [[135.7726, 35.0297], [135.7845, 35.0291], [135.7982, 35.027]],
      },
      {
        id: "route-10",
        dayId: "day-5",
        from: "Ginkaku-ji",
        to: "Monk",
        mode: "walk",
        durationMinutes: 17,
        state: "ready",
        path: [[135.7982, 35.027], [135.7968, 35.0225], [135.7954, 35.0186]],
      },
      {
        id: "route-11",
        dayId: "day-5",
        from: "The Gate Hotel Kyoto",
        to: "Kansai Airport courier",
        mode: "taxi",
        durationMinutes: 0,
        state: "unmatched",
        path: [[135.7684, 35.0087]],
      },
    ],
  },
};
