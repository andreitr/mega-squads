// Minimal, hand-written ABIs (only what the app uses), `as const` for type-safe args/returns.

// A Megapot explicit pick: 5 normals + a bonusball.
const ticketTuple = {
  type: "tuple",
  components: [
    { name: "normals", type: "uint8[]" },
    { name: "bonusball", type: "uint8" },
  ],
} as const;

export const squadsAbi = [
  // ---- writes ----
  {
    type: "function",
    name: "createPoolWithTickets",
    stateMutability: "nonpayable",
    inputs: [
      { name: "drawingId", type: "uint256" },
      { name: "tickets", type: "tuple[]", components: ticketTuple.components },
      { name: "reserveBps", type: "uint256" },
      { name: "name", type: "string" },
    ],
    outputs: [],
  },
  {
    // Create + buy tickets + lock (go Live) in one transaction — pool is buyable immediately.
    type: "function",
    name: "createPoolWithTicketsAndLock",
    stateMutability: "nonpayable",
    inputs: [
      { name: "drawingId", type: "uint256" },
      { name: "tickets", type: "tuple[]", components: ticketTuple.components },
      { name: "reserveBps", type: "uint256" },
      { name: "name", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "createPool",
    stateMutability: "nonpayable",
    inputs: [
      { name: "drawingId", type: "uint256" },
      { name: "ticketCount", type: "uint256" },
      { name: "reserveBps", type: "uint256" },
      { name: "name", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "addTickets",
    stateMutability: "nonpayable",
    inputs: [
      { name: "drawingId", type: "uint256" },
      { name: "tickets", type: "tuple[]", components: ticketTuple.components },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "lock",
    stateMutability: "nonpayable",
    inputs: [{ name: "drawingId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "buyShares",
    stateMutability: "nonpayable",
    inputs: [
      { name: "organizer", type: "address" },
      { name: "drawingId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "buySharesFor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "organizer", type: "address" },
      { name: "drawingId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claimAndDistribute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "organizer", type: "address" },
      { name: "drawingId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "organizer", type: "address" },
      { name: "drawingId", type: "uint256" },
    ],
    outputs: [],
  },
  // ---- reads ----
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { name: "organizer", type: "address" },
      { name: "drawingId", type: "uint256" },
    ],
    outputs: [
      { name: "state", type: "uint8" }, // 0 None, 1 Building, 2 Live, 3 Settled
      { name: "soldOut", type: "bool" },
      { name: "totalShares", type: "uint256" },
      { name: "sharesForSale", type: "uint256" },
      { name: "sharesSold", type: "uint256" },
      { name: "reserveShares", type: "uint256" },
      { name: "ticketCount", type: "uint256" },
      { name: "pricePerShare", type: "uint256" },
      { name: "ticketFunding", type: "uint256" },
      { name: "totalWinnings", type: "uint256" },
      { name: "feesCollected", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "quoteShares",
    stateMutability: "view",
    inputs: [
      { name: "organizer", type: "address" },
      { name: "drawingId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "sharesOf",
    stateMutability: "view",
    inputs: [
      { name: "organizer", type: "address" },
      { name: "drawingId", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "claimableOf",
    stateMutability: "view",
    inputs: [
      { name: "organizer", type: "address" },
      { name: "drawingId", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getHolders",
    stateMutability: "view",
    inputs: [
      { name: "organizer", type: "address" },
      { name: "drawingId", type: "uint256" },
    ],
    outputs: [
      { name: "holders", type: "address[]" },
      { name: "shareCounts", type: "uint256[]" },
    ],
  },
  {
    type: "function",
    name: "getTicketIds",
    stateMutability: "view",
    inputs: [
      { name: "organizer", type: "address" },
      { name: "drawingId", type: "uint256" },
    ],
    outputs: [{ type: "uint256[]" }],
  },
  {
    type: "function",
    name: "getHistory",
    stateMutability: "view",
    inputs: [{ name: "organizer", type: "address" }],
    outputs: [{ type: "uint256[]" }],
  },
  {
    type: "function",
    name: "poolExists",
    stateMutability: "view",
    inputs: [
      { name: "organizer", type: "address" },
      { name: "drawingId", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  // ---- events ----
  {
    type: "event",
    name: "PoolCreated",
    inputs: [
      { name: "organizer", type: "address", indexed: true },
      { name: "drawingId", type: "uint256", indexed: true },
      { name: "reserveBps", type: "uint256", indexed: false },
      { name: "name", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SharesPurchased",
    inputs: [
      { name: "organizer", type: "address", indexed: true },
      { name: "drawingId", type: "uint256", indexed: true },
      { name: "holder", type: "address", indexed: true },
      { name: "payer", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "newSharesSold", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Distributed",
    inputs: [
      { name: "organizer", type: "address", indexed: true },
      { name: "drawingId", type: "uint256", indexed: true },
      { name: "totalWinnings", type: "uint256", indexed: false },
      { name: "soldOut", type: "bool", indexed: false },
      { name: "feesReleased", type: "uint256", indexed: false },
    ],
  },
] as const;

export const jackpotAbi = [
  {
    type: "function",
    name: "currentDrawingId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getDrawingState",
    stateMutability: "view",
    inputs: [{ name: "drawingId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "prizePool", type: "uint256" },
          { name: "ticketPrice", type: "uint256" },
          { name: "edgePerTicket", type: "uint256" },
          { name: "referralWinShare", type: "uint256" },
          { name: "referralFee", type: "uint256" },
          { name: "globalTicketsBought", type: "uint256" },
          { name: "lpEarnings", type: "uint256" },
          { name: "drawingTime", type: "uint256" },
          { name: "winningTicket", type: "uint256" },
          { name: "ballMax", type: "uint8" },
          { name: "bonusballMax", type: "uint8" },
          { name: "payoutCalculator", type: "address" },
          { name: "jackpotLock", type: "bool" },
        ],
      },
    ],
  },
] as const;

export const payoutCalcAbi = [
  {
    type: "function",
    name: "getExpectedDrawingTierPayouts",
    stateMutability: "view",
    inputs: [
      { name: "_drawingId", type: "uint256" },
      { name: "_prizePool", type: "uint256" },
      { name: "_normalMax", type: "uint8" },
      { name: "_bonusballMax", type: "uint8" },
    ],
    // index 11 (5 normals + bonusball) is the jackpot tier; indices 0 and 2 are non-paying (0).
    outputs: [{ name: "drawingTierPayouts", type: "uint256[12]" }],
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;
