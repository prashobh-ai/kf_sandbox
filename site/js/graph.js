// =============================================================================
// Knowledge graph — renders entities and relationships, highlights reasoning trace.
// =============================================================================

const NODE_BASE = '#4a5478';
const NODE_RELATED = '#6b8eff';
const NODE_ACTIVE = '#5ee3c5';
const EDGE_BASE = '#2a3354';
const EDGE_ACTIVE = '#5ee3c5';

// =============================================================================
// Graph wrapper
// =============================================================================
export class KnowledgeGraph {
  constructor(container, index) {
    this.container = container;
    this.index = index;
    this.entitiesById = new Map(index.entities.map(e => [e.id, e]));
    this.chunksById = new Map(index.chunks.map(c => [c.id, c]));
    this.relationships = index.relationships;

    this.nodes = null;
    this.edges = null;
    this.network = null;
    this.onEntityClick = null;
  }

  render() {
    const nodes = this.index.entities.map(e => ({
      id: e.id,
      label: e.name,
      title: `${e.name} · ${e.mention_count} mentions`,
      value: e.mention_count,
      color: { background: NODE_BASE, border: NODE_BASE, highlight: { background: NODE_ACTIVE, border: NODE_ACTIVE } },
      font: { color: '#9ba3bd', size: 12, face: 'Inter' },
      borderWidth: 0,
      shape: 'dot',
    }));

    const edges = this.relationships.map((r, i) => ({
      id: i,
      from: r.source,
      to: r.target,
      value: r.weight,
      color: { color: EDGE_BASE, highlight: EDGE_ACTIVE, opacity: 0.4 },
      smooth: { type: 'continuous', roundness: 0.2 },
    }));

    this.nodes = new vis.DataSet(nodes);
    this.edges = new vis.DataSet(edges);

    const data = { nodes: this.nodes, edges: this.edges };

    const options = {
      autoResize: true,
      physics: {
        enabled: true,
        solver: 'forceAtlas2Based',
        forceAtlas2Based: {
          gravitationalConstant: -42,
          centralGravity: 0.008,
          springLength: 130,
          springConstant: 0.06,
          damping: 0.55,
          avoidOverlap: 0.7,
        },
        stabilization: { iterations: 220, updateInterval: 25 },
        minVelocity: 0.15,
      },
      interaction: {
        hover: true,
        tooltipDelay: 180,
        dragNodes: true,
        zoomView: true,
      },
      nodes: {
        scaling: { min: 8, max: 30, label: { enabled: true, min: 11, max: 16 } },
        shadow: { enabled: true, color: 'rgba(89, 232, 197, 0.18)', size: 8, x: 0, y: 0 },
      },
      edges: {
        width: 0.5,
        scaling: { min: 0.4, max: 3 },
        smooth: { type: 'continuous', roundness: 0.18 },
      },
    };

    this.network = new vis.Network(this.container, data, options);

    this.network.on('click', params => {
      if (params.nodes.length > 0 && this.onEntityClick) {
        this.onEntityClick(params.nodes[0]);
      }
    });

    // Auto-fit after stabilization
    this.network.once('stabilizationIterationsDone', () => {
      this.network.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
    });
  }

  // ===========================================================================
  // Reasoning trace: highlight entities that appear in the retrieved chunks,
  // plus their direct neighbors, and the edges connecting them.
  // ===========================================================================
  highlightTrace(retrievedChunkIds) {
    const activeEntityIds = new Set();
    for (const cid of retrievedChunkIds) {
      const chunk = this.chunksById.get(cid);
      if (!chunk) continue;
      for (const eid of chunk.entities || []) activeEntityIds.add(eid);
    }

    const neighborIds = new Set();
    const activeEdgeIds = new Set();
    for (let i = 0; i < this.relationships.length; i++) {
      const r = this.relationships[i];
      const srcActive = activeEntityIds.has(r.source);
      const tgtActive = activeEntityIds.has(r.target);
      if (srcActive && tgtActive) {
        activeEdgeIds.add(i);
      } else if (srcActive) {
        neighborIds.add(r.target);
        activeEdgeIds.add(i);
      } else if (tgtActive) {
        neighborIds.add(r.source);
        activeEdgeIds.add(i);
      }
    }

    const nodeUpdates = [];
    for (const entity of this.index.entities) {
      if (activeEntityIds.has(entity.id)) {
        // Activated: bright, bordered, glowing, larger label — these are the
        // concepts the answer was actually built from.
        nodeUpdates.push({
          id: entity.id,
          color: { background: NODE_ACTIVE, border: '#c7fff0' },
          font: { color: '#ffffff', size: 16, face: 'Inter', strokeWidth: 3, strokeColor: '#06231d' },
          borderWidth: 3,
          shadow: { enabled: true, color: 'rgba(94,227,197,0.9)', size: 26, x: 0, y: 0 },
        });
      } else if (neighborIds.has(entity.id)) {
        // One hop away: related context.
        nodeUpdates.push({
          id: entity.id,
          color: { background: NODE_RELATED, border: NODE_RELATED },
          font: { color: '#b9c2e0', size: 12, face: 'Inter', strokeWidth: 0 },
          borderWidth: 0,
          shadow: { enabled: false },
        });
      } else {
        // Everything else: pushed far back so the activation stands out.
        nodeUpdates.push({
          id: entity.id,
          color: { background: 'rgba(74,84,120,0.30)', border: 'rgba(74,84,120,0.30)' },
          font: { color: 'rgba(120,128,150,0.45)', size: 10, face: 'Inter', strokeWidth: 0 },
          borderWidth: 0,
          shadow: { enabled: false },
        });
      }
    }
    this.nodes.update(nodeUpdates);

    const edgeUpdates = this.relationships.map((r, i) => ({
      id: i,
      color: activeEdgeIds.has(i)
        ? { color: EDGE_ACTIVE, opacity: 0.8 }
        : { color: EDGE_BASE, opacity: 0.15 },
      width: activeEdgeIds.has(i) ? Math.max(1, Math.log(r.weight + 1) * 0.8) : 0.4,
    }));
    this.edges.update(edgeUpdates);

    if (activeEntityIds.size > 0) {
      this.network.fit({
        nodes: [...activeEntityIds, ...neighborIds],
        animation: { duration: 600, easingFunction: 'easeInOutQuad' },
      });
    }

    return {
      activeEntities: [...activeEntityIds].map(id => this.entitiesById.get(id)).filter(Boolean),
      neighborCount: neighborIds.size,
      edgeCount: activeEdgeIds.size,
    };
  }

  resetHighlight() {
    const nodeUpdates = this.index.entities.map(e => ({
      id: e.id,
      color: { background: NODE_BASE, border: NODE_BASE },
      font: { color: '#9ba3bd', size: 12, face: 'Inter', strokeWidth: 0 },
      borderWidth: 0,
      shadow: { enabled: false },
    }));
    this.nodes.update(nodeUpdates);

    const edgeUpdates = this.relationships.map((r, i) => ({
      id: i,
      color: { color: EDGE_BASE, opacity: 0.4 },
      width: 0.5,
    }));
    this.edges.update(edgeUpdates);
  }

  focusEntity(entityId) {
    this.network.selectNodes([entityId]);
    this.network.focus(entityId, {
      scale: 1.2,
      animation: { duration: 400, easingFunction: 'easeInOutQuad' },
    });
  }
}
