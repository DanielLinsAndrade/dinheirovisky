export interface CardInput {
  id: number | null;
  name: string;
  institution: string;
  lastFour: string | null;
  brand: string | null;
  creditLimit: number;
  closingDay: number;
  dueDay: number;
  defaultAccountId: number | null;
}
export interface CreditCard extends CardInput {
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface CardDates {
  month: string;
  closingDate: string;
  dueDate: string;
}
