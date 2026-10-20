import { GoogleAuth } from 'google-auth-library';
import { error, info } from 'firebase-functions/logger';
import { projectID } from 'firebase-functions/params';
import { onMessagePublished } from 'firebase-functions/v2/pubsub';

/** The Pub/Sub topic each project's budget notifies (scripts/create-budget.sh). */
export const BUDGET_TOPIC = 'budget-alerts';

/** The parts of a Cloud Billing budget notification that the cap reads. */
export interface BudgetNotification {
  budgetDisplayName: string;
  costAmount: number;
  budgetAmount: number;
  currencyCode: string;
}

/** Reads and changes a project's billing link, through the Cloud Billing API. */
export interface BillingApi {
  isEnabled(projectId: string): Promise<boolean>;
  disable(projectId: string): Promise<void>;
}

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-billing'] });

export const cloudBilling: BillingApi = {
  async isEnabled(projectId) {
    const { data } = await auth.request<{ billingEnabled?: boolean }>({
      url: `https://cloudbilling.googleapis.com/v1/projects/${projectId}/billingInfo`,
    });
    return data.billingEnabled === true;
  },
  async disable(projectId) {
    // An empty billing account unlinks the project. Linking it again is done by hand.
    await auth.request({
      url: `https://cloudbilling.googleapis.com/v1/projects/${projectId}/billingInfo`,
      method: 'PUT',
      data: { billingAccountName: '' },
    });
  },
};

/**
 * Turns off billing for the project once actual spend this month reaches its budget (NKB-112).
 * Forecasts never trigger it. Budgets notify several times a day whatever the spend, so most
 * notifications do nothing. Returns whether billing was turned off.
 */
export async function capBilling(
  billing: BillingApi,
  projectId: string,
  budget: BudgetNotification | null,
): Promise<boolean> {
  if (!budget || !(budget.costAmount >= budget.budgetAmount)) {
    return false;
  }

  const spend = {
    budget: budget.budgetDisplayName,
    cost: budget.costAmount,
    limit: budget.budgetAmount,
    currency: budget.currencyCode,
  };
  if (!(await billing.isEnabled(projectId))) {
    info('Budget reached, billing already off', { project: projectId, ...spend });
    return false;
  }

  await billing.disable(projectId);
  // Logged as an error so it stands out; docs/handbook/costs.md says what to do next.
  error('Budget reached: billing turned off', { project: projectId, ...spend });
  return true;
}

/** Receives the project's budget notifications and applies the cap. */
export const enforceBudget = onMessagePublished<BudgetNotification>(
  { topic: BUDGET_TOPIC, retry: true },
  async (event) => {
    let budget: BudgetNotification;
    try {
      budget = event.data.message.json;
    } catch {
      // Not from a budget. Retrying would not help, so drop it.
      error('Budget notification is not JSON', { messageId: event.data.message.messageId });
      return;
    }
    await capBilling(cloudBilling, projectID.value(), budget);
  },
);
