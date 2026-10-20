import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { auth } from 'firebase-functions/v1';

import { USERS } from './model';

// gRPC ALREADY_EXISTS, raised by create() when the document is already there.
const ALREADY_EXISTS = 6;

// Every new account starts as a member. Admin accounts (NKB-210) write their own users record,
// which this trigger must not overwrite, so it only ever creates.
export const createUserRecord = auth.user().onCreate(async (user) => {
  try {
    await getFirestore()
      .collection(USERS)
      .doc(user.uid)
      .create({
        role: 'member',
        email: user.email ?? null,
        createdAt: FieldValue.serverTimestamp(),
      });
  } catch (error) {
    if ((error as { code?: unknown }).code !== ALREADY_EXISTS) {
      throw error;
    }
  }
});
