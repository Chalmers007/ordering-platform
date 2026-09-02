'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from 'react';
import type { Cart, CartLine, CartModifierSelection, FulfillmentType } from '@/types/database';
import { keyOf, lineKey } from './line-key';

/**
 * Cart state lives in the browser and is persisted per tenant, so a customer
 * with two storefronts open never sees one restaurant's cart on another's
 * page. It holds selections and quantities only — never prices. Money comes
 * from `price_cart()` via /api/cart/validate.
 */

type CartAction =
  | { type: 'add'; menuItemId: string; quantity: number; modifiers: CartModifierSelection[]; notes?: string }
  | { type: 'setQuantity'; lineId: string; quantity: number }
  | { type: 'remove'; lineId: string }
  | { type: 'setFulfillment'; fulfillmentType: FulfillmentType }
  | { type: 'setTip'; tipCents: number }
  | { type: 'clear' }
  | { type: 'hydrate'; cart: Cart };

function reducer(state: Cart, action: CartAction): Cart {
  switch (action.type) {
    case 'add': {
      const id = lineKey(action.menuItemId, action.modifiers, action.notes);
      const existing = state.lines.find((l) => keyOf(l) === id);

      if (existing) {
        return {
          ...state,
          lines: state.lines.map((l) =>
            keyOf(l) === id ? { ...l, quantity: Math.min(l.quantity + action.quantity, 999) } : l,
          ),
        };
      }

      const line: CartLine = {
        lineId: id,
        menuItemId: action.menuItemId,
        quantity: action.quantity,
        modifiers: action.modifiers,
        ...(action.notes ? { notes: action.notes } : {}),
      };
      return { ...state, lines: [...state.lines, line] };
    }

    case 'setQuantity': {
      if (action.quantity < 1) {
        return { ...state, lines: state.lines.filter((l) => l.lineId !== action.lineId) };
      }
      return {
        ...state,
        lines: state.lines.map((l) =>
          l.lineId === action.lineId ? { ...l, quantity: Math.min(action.quantity, 999) } : l,
        ),
      };
    }

    case 'remove':
      return { ...state, lines: state.lines.filter((l) => l.lineId !== action.lineId) };

    case 'setFulfillment':
      return { ...state, fulfillmentType: action.fulfillmentType };

    case 'setTip':
      return { ...state, tipCents: Math.max(0, Math.round(action.tipCents)) };

    case 'clear':
      return { ...state, lines: [], tipCents: 0 };

    case 'hydrate':
      return action.cart;
  }
}

function emptyCart(tenantId: string, fulfillmentType: FulfillmentType): Cart {
  return { tenantId, fulfillmentType, lines: [], tipCents: 0 };
}

const STORAGE_PREFIX = 'op.cart.';

type CartContextValue = {
  cart: Cart;
  itemCount: number;
  hydrated: boolean;
  addLine: (input: {
    menuItemId: string;
    quantity: number;
    modifiers: CartModifierSelection[];
    notes?: string;
  }) => void;
  setQuantity: (lineId: string, quantity: number) => void;
  removeLine: (lineId: string) => void;
  setFulfillment: (fulfillmentType: FulfillmentType) => void;
  setTip: (tipCents: number) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({
  tenantId,
  defaultFulfillment,
  children,
}: {
  tenantId: string;
  defaultFulfillment: FulfillmentType;
  children: ReactNode;
}) {
  const [cart, dispatch] = useReducer(reducer, emptyCart(tenantId, defaultFulfillment));
  const [hydrated, setHydrated] = useState(false);

  // Restore after mount, never during render: the server has no localStorage,
  // and reading it while rendering guarantees a hydration mismatch.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_PREFIX + tenantId);
      if (raw) {
        const parsed = JSON.parse(raw) as Cart;
        if (parsed?.tenantId === tenantId && Array.isArray(parsed.lines)) {
          dispatch({ type: 'hydrate', cart: parsed });
        }
      }
    } catch {
      // Corrupt or unavailable storage must not break the storefront.
    }
    setHydrated(true);
  }, [tenantId]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_PREFIX + tenantId, JSON.stringify(cart));
    } catch {
      // Private browsing / quota. The cart still works for this session.
    }
  }, [cart, hydrated, tenantId]);

  const addLine = useCallback<CartContextValue['addLine']>((input) => {
    dispatch({ type: 'add', ...input });
  }, []);

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      hydrated,
      itemCount: cart.lines.reduce((n, l) => n + l.quantity, 0),
      addLine,
      setQuantity: (lineId, quantity) => dispatch({ type: 'setQuantity', lineId, quantity }),
      removeLine: (lineId) => dispatch({ type: 'remove', lineId }),
      setFulfillment: (fulfillmentType) => dispatch({ type: 'setFulfillment', fulfillmentType }),
      setTip: (tipCents) => dispatch({ type: 'setTip', tipCents }),
      clear: () => dispatch({ type: 'clear' }),
    }),
    [cart, hydrated, addLine],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used inside a CartProvider');
  return context;
}
