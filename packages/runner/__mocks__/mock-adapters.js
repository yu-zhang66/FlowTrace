/**
 * Mock Legacy Flow Adapter for testing
 * Simulates legacy system behavior with predictable outcomes
 */
export class MockLegacyFlowAdapter {
    name = 'MockLegacyFlowAdapter';
    type = 'legacy';
    context;
    externalCalls = [];
    _semanticPath = [];
    initialized = false;
    cleanupCalled = false;
    // Configurable behavior
    shouldFail = false;
    failureMessage;
    customFinalState;
    customSemanticPath;
    actionDelay = 0;
    constructor(context) {
        this.context = context;
    }
    // Configuration methods
    setShouldFail(shouldFail, message) {
        this.shouldFail = shouldFail;
        this.failureMessage = message;
    }
    setFinalState(state) {
        this.customFinalState = state;
    }
    setSemanticPath(path) {
        this.customSemanticPath = path;
    }
    setActionDelay(ms) {
        this.actionDelay = ms;
    }
    get initializedStatus() {
        return this.initialized;
    }
    get cleanupWasCalled() {
        return this.cleanupCalled;
    }
    get semanticPath() {
        return this._semanticPath;
    }
    async initialize() {
        this.initialized = true;
        this.externalCalls = [];
        this._semanticPath = [];
    }
    async cleanup() {
        this.cleanupCalled = true;
        this.externalCalls = [];
        this._semanticPath = [];
    }
    async executeAction(action) {
        if (this.actionDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, this.actionDelay));
        }
        const stateTransitions = {
            'SUBMIT': 'SUBMITTED',
            'APPROVE': 'APPROVED',
            'REJECT': 'REJECTED',
            'RETURN': 'RETURNED',
            'WITHDRAW': 'WITHDRAWN',
            'TRANSFER': 'TRANSFERRED',
            'COUNTERSIGN': 'PENDING_COUNTERSIGN',
            'COUNTERSIGN_COMPLETE': 'COUNTERSIGNED',
            'LOGIN': 'AUTHENTICATED'
        };
        const finalState = this.customFinalState || stateTransitions[action.type] || 'DRAFT';
        this._semanticPath.push(finalState);
        if (this.shouldFail) {
            throw new Error(this.failureMessage || 'Legacy adapter execution failed');
        }
        return {
            scenarioId: 'mock',
            adapter: 'legacy',
            actions: [action],
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            finalState,
            semanticPath: this._semanticPath,
            businessData: { actor: action.actor, type: action.type },
            metadata: { adapterName: this.name }
        };
    }
    async executeScenario(scenario) {
        const startTime = new Date().toISOString();
        const executedActions = [];
        let finalState = 'DRAFT';
        for (const action of scenario.actions) {
            const result = await this.executeAction(action);
            executedActions.push(action);
            finalState = result.finalState;
        }
        return {
            scenarioId: scenario.id,
            adapter: 'legacy',
            actions: executedActions,
            startTime,
            endTime: new Date().toISOString(),
            finalState,
            semanticPath: this.customSemanticPath || this._semanticPath,
            businessData: { processId: scenario.process },
            externalCalls: this.externalCalls
        };
    }
    async captureExternalCalls() {
        return [...this.externalCalls];
    }
    async resetTestData() {
        this.externalCalls = [];
        this._semanticPath = [];
    }
    getSemanticPath() {
        return this._semanticPath;
    }
    // Helper to add external calls for testing
    addExternalCall(call) {
        this.externalCalls.push(call);
    }
}
/**
 * Mock Current Flow Adapter for testing
 * Simulates current system behavior with configurable outcomes
 */
export class MockCurrentFlowAdapter {
    name = 'MockCurrentFlowAdapter';
    type = 'current';
    context;
    externalCalls = [];
    _semanticPath = [];
    initialized = false;
    cleanupCalled = false;
    legacyShadowMode = false;
    // Configurable behavior
    shouldFail = false;
    failureMessage;
    customFinalState;
    customSemanticPath;
    actionDelay = 0;
    actionResults = new Map();
    constructor(context, legacyShadowMode = false) {
        this.context = context;
        this.legacyShadowMode = legacyShadowMode;
    }
    // Configuration methods
    setShouldFail(shouldFail, message) {
        this.shouldFail = shouldFail;
        this.failureMessage = message;
    }
    setFinalState(state) {
        this.customFinalState = state;
    }
    setSemanticPath(path) {
        this.customSemanticPath = path;
    }
    setActionDelay(ms) {
        this.actionDelay = ms;
    }
    setLegacyShadowMode(enabled) {
        this.legacyShadowMode = enabled;
    }
    get initializedStatus() {
        return this.initialized;
    }
    get cleanupWasCalled() {
        return this.cleanupCalled;
    }
    get semanticPath() {
        return this._semanticPath;
    }
    // Set custom result for a specific action type
    setActionResult(actionType, result) {
        this.actionResults.set(actionType, result);
    }
    async initialize() {
        this.initialized = true;
        this.externalCalls = [];
        this._semanticPath = [];
    }
    async cleanup() {
        this.cleanupCalled = true;
        this.externalCalls = [];
        this._semanticPath = [];
    }
    async executeAction(action) {
        if (this.actionDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, this.actionDelay));
        }
        // Check for custom result
        const customResult = this.actionResults.get(action.type);
        if (customResult) {
            return {
                ...customResult,
                adapter: 'current',
                actions: [action]
            };
        }
        const stateTransitions = {
            'SUBMIT': 'SUBMITTED',
            'APPROVE': 'APPROVED',
            'REJECT': 'REJECTED',
            'RETURN': 'RETURNED',
            'WITHDRAW': 'WITHDRAWN',
            'TRANSFER': 'TRANSFERRED',
            'COUNTERSIGN': 'PENDING_COUNTERSIGN',
            'COUNTERSIGN_COMPLETE': 'COUNTERSIGNED',
            'LOGIN': 'AUTHENTICATED'
        };
        // In legacy shadow mode, use same transitions as legacy
        const finalState = this.customFinalState || stateTransitions[action.type] || 'DRAFT';
        this._semanticPath.push(finalState);
        if (this.shouldFail) {
            throw new Error(this.failureMessage || 'Current adapter execution failed');
        }
        return {
            scenarioId: 'mock',
            adapter: 'current',
            actions: [action],
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            finalState,
            semanticPath: this._semanticPath,
            businessData: { actor: action.actor, type: action.type },
            metadata: { adapterName: this.name }
        };
    }
    async executeScenario(scenario) {
        const startTime = new Date().toISOString();
        const executedActions = [];
        let finalState = 'DRAFT';
        for (const action of scenario.actions) {
            const result = await this.executeAction(action);
            executedActions.push(action);
            finalState = result.finalState;
        }
        return {
            scenarioId: scenario.id,
            adapter: 'current',
            actions: executedActions,
            startTime,
            endTime: new Date().toISOString(),
            finalState,
            semanticPath: this.customSemanticPath || this._semanticPath,
            businessData: { processId: scenario.process },
            externalCalls: this.externalCalls
        };
    }
    async captureExternalCalls() {
        return [...this.externalCalls];
    }
    async resetTestData() {
        this.externalCalls = [];
        this._semanticPath = [];
    }
    getSemanticPath() {
        return this._semanticPath;
    }
    // Helper to add external calls for testing
    addExternalCall(call) {
        this.externalCalls.push(call);
    }
}
//# sourceMappingURL=mock-adapters.js.map