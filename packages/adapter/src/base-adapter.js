export class BaseFlowAdapter {
    externalCalls = [];
    async initialize() {
        // Default implementation - override in subclasses
    }
    async cleanup() {
        this.externalCalls = [];
    }
    async executeScenario(scenario) {
        const startTime = new Date().toISOString();
        const semanticPath = [];
        const executedActions = [];
        let finalState = 'DRAFT';
        let error;
        let actionError;
        let businessData = {};
        for (const action of scenario.actions) {
            try {
                const result = await this.executeAction(action);
                executedActions.push(action);
                semanticPath.push(result.finalState);
                finalState = result.finalState;
                businessData = result.businessData || {};
                // Check if the action resulted in an error
                if (result.error) {
                    actionError = `Action ${action.type} by ${action.actor} failed: ${result.error}`;
                    error = actionError;
                    // Record the error and stop executing further actions
                    break;
                }
            }
            catch (err) {
                // Action execution threw an exception
                actionError = `Action ${action.type} by ${action.actor} threw exception: ${err instanceof Error ? err.message : String(err)}`;
                error = actionError;
                executedActions.push(action);
                // Stop executing further actions
                break;
            }
        }
        const endTime = new Date().toISOString();
        return {
            scenarioId: scenario.id,
            adapter: this.type,
            actions: executedActions,
            startTime,
            endTime,
            finalState: error ? `ERROR: ${finalState}` : finalState,
            semanticPath,
            businessData,
            databaseChanges: scenario.expected.database,
            externalCalls: this.externalCalls,
            error,
            metadata: {
                adapterName: this.name,
                context: this.context,
                actionError
            }
        };
    }
    async captureExternalCalls() {
        return [...this.externalCalls];
    }
    async resetTestData() {
        // Default implementation - override in subclasses
    }
    getSemanticPath() {
        return this.externalCalls.map(call => call.endpoint);
    }
    createExecutionResult(scenarioId, actions, finalState, semanticPath, businessData, error) {
        return {
            scenarioId,
            adapter: this.type,
            actions,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            finalState,
            semanticPath,
            businessData,
            externalCalls: this.externalCalls,
            error,
            metadata: {
                adapterName: this.name
            }
        };
    }
}
export class BaseDataAdapter {
    connected = false;
    async connect() {
        this.connected = true;
    }
    async disconnect() {
        this.connected = false;
    }
}
//# sourceMappingURL=base-adapter.js.map