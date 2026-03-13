export const TRANSACTION_FEE = 140;

export const getTransactionFee = () => {
  const configured =
    Number(process.env.BOOKING_TRANSACTION_FEE ?? process.env.BOOKING_BLOCKCHAIN_RECORDING_FEE ?? TRANSACTION_FEE);
  if (!Number.isFinite(configured) || configured < 0) return 0;
  return Math.round(configured * 100) / 100;
};
