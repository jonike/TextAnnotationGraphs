const TreeLayout = (function() {

    // depth of recursion
    let maxDepth;

    // recursively build hierarchy from a root word or link
    function addNode(node, depth, source) {
        let incoming = [];

        let data = {
            node,
            incoming,
            name: node instanceof Word ? node.val : node.textStr,
            type: node instanceof Word ? 'Word' : 'Link'
        };

        if (depth < maxDepth) {
            let children = node.links
                .filter(parent => {
                    // ignore "incoming" links
                    if (parent !== source && parent instanceof Link) {
                        const i = parent.words.indexOf(node);
                        if (i < 0 || parent.arrowDirections[i] === -1) {
                            incoming.push(parent);
                            return false;
                        }
                    }
                    return parent !== source;
                })
                .map((parent) => addNode(parent, depth + 1, node));

            if (node instanceof Link) {
                let anchors = node.words
                    .map((word, i) => {
                        if (word !== source) {
                            const newNode = addNode(word, depth + 1, node);

                            if (node.arrowDirections[i] === -1) {
                                newNode.receivesArrow = true;
                            }

                            return newNode;
                        }
                        return null;
                    })
                    .filter(word => word);

                children = children.concat(anchors);
            }

            if (children.length > 0) {
                data.children = children;
            }
        }

        return data;
    };

    class TreeLayout {
        constructor(el) {
            // container element
            this.svg = d3.select(el);
            this.draggable = this.svg.append('g');
            this.g = this.draggable.append('g');

            // add zoom/pan events
            this.svg.call(d3.zoom()
              .scaleExtent([1 / 2, 4])
              .on("zoom", () => {
                this.draggable.attr('transform', d3.event.transform);
              }))
              .on("dblclick.zoom", null);

            // selected words to generate graph around
            this.word = null;
            this.maxDepth = 20; // default value for max dist from root
        }
        resize() {
          // let bounds = this.svg.node().getBoundingClientRect();
          // this.g.attr('transform', `translate(${bounds.width / 2}, 30)`);// ${bounds.height / 2})`);
        }
        clear() {
            this.word = null;
            this.g.selectAll('*').remove();
        }

        /**
         * construct a set of hierarchies from an array of
         * Word or Link "root" nodes
         */
        graph(selected) {
            this.resize();

            maxDepth = this.maxDepth;

            let data = [];

            function addNode(node, source = null, depth = 0) {
              let data = {
                node,
                depth,
                children: [],
                siblings: []
              };

              if (depth < maxDepth) {
                let links = node.links.filter(l => l.top);
                let args = [];
                let corefs = links.filter(x => !x.trigger)
                  .map(coref => {
                    return {
                      type: coref.reltype,
                      args: coref.arguments.filter(x => x.anchor !== node && x.anchor !== source)
                        .map(x => addNode(x.anchor, node, depth))
                    };
                  });

                if (node instanceof Word) {
                  args = links.filter(x => x.trigger === node);
                }
                else if (node instanceof Link) {
                  args = node.arguments.map(x => x.anchor);
                }

                data.children = args.map(arg => addNode(arg, data, depth + 1));
                data.siblings = corefs;
              }

              return data;
            }

            let hierarchy = addNode(selected);

            let [nodes, links] = (function() {
              let nodes = [];
              let links = [];

              function flatten(node) {
                nodes.push(node);
                node.siblings.forEach(sibling => {
                  sibling.args.forEach(arg => {
                    flatten(arg);
                    links.push({
                      type: 'sibling',
                      label: sibling.type,
                      source: node,
                      target: arg
                    });
                  });
                });
                node.children.forEach(child => {
                  flatten(child);
                  links.push({
                    type: 'child',
                    source: node,
                    target: child
                  })
                });
              }
              flatten(hierarchy);

              return [nodes, links];
            })();


            let maxWidth = 0;
            let layers = [];
            nodes.forEach(node => {
              layers[node.depth] = layers[node.depth] || [];
              layers[node.depth].push(node);
            });

            function shiftSubtree(node, dx, root) {
              node.offset += dx;
              if (node.offset > maxWidth) { maxWidth = node.offset; }
              if (!root) {
                node.siblings.forEach(node => shiftSubtree(node, dx))
              }
              node.children.forEach(node => shiftSubtree(node, dx));
            }
            for (let i = layers.length - 1; i >= 0; --i) {
              layers[i].forEach((node, j) => {
                // 1st pass: assign an initial offset according to children
                if (node.children.length > 0) {
                  let leftChild = node.children[0];
                  let rightChild = node.children[node.children.length - 1];
                  node.offset = (leftChild.offset + rightChild.offset) / 2;
                }
                else if (j > 0) {
                  node.offset = layers[i][j - 1].offset;
                }
                else {
                  node.offset = 0;
                }
              });

              // 2nd pass: check that subtree doesn't collide with left tree
              function computeWidth(word, svg) {
                let text = svg.append('text').text(word);
                let length = text.node().getComputedTextLength();
                text.remove();
                return length;
              }

              layers[i].forEach((node, j) => {
                node.width = computeWidth(node.node.val, this.svg);
                if (j > 0) {
                  const prev = layers[i][j - 1];
                  const separation = prev.siblings.some(sibling => sibling.args.indexOf(node) > -1) ? 50 : 20; // TODO: make more universal

                  let dx = prev.offset + prev.width / 2 + node.width / 2 - node.offset + separation;
                  if (dx > 0) {
                    // shift subtree and right-ward trees by dx
                    for (let k = j; k < layers[i].length; ++k) {
                      shiftSubtree(layers[i][k], dx, true);
                    }
                  }
                }
                if (node.offset > maxWidth) { maxWidth = node.offset; }
              });
            }// end for


            let nodeSVG = this.g.selectAll('.node')
              .data(nodes, d => d.node);

            let edgeSVG = this.g.selectAll('.edge')
              .data(links, d => d.parent);

            //layout constants
            const rh = 50;  // row height
            nodeSVG.exit().remove();
            nodeSVG.enter().append('text')
              .attr('class','node')
              .attr('text-anchor', 'middle')
              .attr('transform', d => 'translate(' + [d.offset, d.depth * rh] + ')')
            .merge(nodeSVG)
              .text(d => d.node.val)
              .transition()
                .attr('transform', d => 'translate(' + [d.offset, d.depth * rh] + ')');

            // resize
            let bounds = this.svg.node().getBoundingClientRect();
            this.g.attr('transform', 'translate(' + [bounds.width / 2 - maxWidth / 2, bounds.height / 2 - layers.length * rh / 2] + ')');

            edgeSVG.exit().remove();
            edgeSVG.enter().append('path')
              .attr('class', 'edge')
              .attr('stroke', 'grey')
              .attr('stroke-width', '1px')
              .attr('fill','none')
            .merge(edgeSVG)
              .attr('d', d => {
                if (d.type === 'sibling') {
                  let x1, x2;
                  if (d.target.offset > d.source.offset) {
                    x1 = d.source.offset + d.source.width / 2;
                    x2 = d.target.offset - d.target.width / 2;
                  }
                  else {
                    x1 = d.target.offset + d.target.width / 2;
                    x2 = d.source.offset - d.source.width / 2;
                  }
                  return 'M' + [x1 - 10, d.source.depth * rh + 5]
                    + 'v7h' + (x2 - x1 + 20) + 'v-7';
                }
                else if (d.type === 'child') {
                  return 'M' + [d.source.offset, d.source.depth * rh + 5]
                    + 'C' + [
                      d.source.offset, d.source.depth * rh + 25,
                      d.target.offset, d.target.depth * rh - 40,
                      d.target.offset, d.target.depth * rh - 15
                    ];
                }
              })
        }

        updateIncoming(data, index) {

            const seed = addNode(data.node, 0, null);
            const root = d3.hierarchy(seed);

            const anchorInNewTree = root.descendants().find(node => node.data.node === data.anchor.data.node);

            let tree2 = tree(root);

            // remove extraneous hooks / shared nodes
            let range = d3.extent(root.leaves().concat(data.anchor), d => d.x);

            data.anchor.data.incoming.splice(data.anchor.data.incoming.indexOf(data.node), 1);
            anchorInNewTree.parent.children.splice(anchorInNewTree.parent.children.indexOf(anchorInNewTree), 1);

            // translate grafted tree onto old tree
            let dy = data.anchor.y - anchorInNewTree.y;
            let dx = data.anchor.x - anchorInNewTree.x;
            root.descendants().forEach(node => {
                node.x += dx;
                node.y += dy;
            });

            this.data.push({
                index,
                root,
                dx,
                tree: tree2,
                anchor: data.anchor,
                offset: this.data[index].offset
            });

            this.updateGraph();
        }

        updateGraph() {
            let group = this.g.selectAll('.group')
                .data(this.data);

            group.exit().remove();

            let groupEnter = group.enter().append('g')
                .attr('class','group')

            groupEnter.append('g')
                .attr('class', 'linkGroup');
            groupEnter.append('g')
                .attr('class', 'nodeGroup');

            let groupMerge = groupEnter.merge(group);

            groupMerge.select('.linkGroup')
                .datum((d, i, el) => {
                    el = d3.select(el[i])
                        .attr('transform', 'translate(' + d.offset + ', 0)');
                    this.drawLinks(d.tree, el);
                    if (d.anchor) {
                        let [x1, y1] = [d.root.y, d.root.x];
                        let [x2, y2] = [d.anchor.y, d.anchor.x];
                        let curve_offset = 20;
                        el.select('.link--dashed').remove();
                        el.append('path')
                            .attr('class','link--dashed')
                            .attr('d', 'M' + [x1, y1] +
                                'C' + [x1 + curve_offset, y1, x1 + curve_offset, y2, x2, y2]);
                    }
                    else {
                        el.select('.link--dashed').remove();
                    }
                });

            groupMerge.select('.nodeGroup')
                .datum((d, i, el) => {
                    el = d3.select(el[i])
                        .attr('transform', 'translate(' + d.offset + ', 0)');

                    if (!isNaN(d.index)) { i = d.index; }
                    this.drawNodes(d.root, i, el);
                });
        }
        drawLinks(tree, el) {
            let link = el.selectAll('.link')
                .data(tree.links());

            link.exit().remove();

            link.enter().append('path')
                .attr('class', 'link')
            .merge(link)
                .transition()
                .attr('d', (d) => {
                    let [x1, y1] = [d.source.y, d.source.x];
                    let [x2, y2] = [d.target.y, d.target.x];
                    let curve_offset = 20;

                    // check if arrows are directional
                    if ( d.source.children.length > 1 &&
                         d.source.data.type === 'Link' &&
                         d.source.data.node.arrowDirections.indexOf(-1) > -1 ) {

                        return 'M' + [x1, y1] +
                            'C' + [x1, y2, x1, y2, x2, y2];
                    }

                    return 'M' + [x1, y1] +
                        'C' + [x1 + curve_offset, y1, x1 + curve_offset, y2, x2, y2];
                  });
        }
        drawNodes(root, i, el) {
            function handleNodeClick(d) {
                unhoverNode(d);
                this.word = d.node;
                this.graph(this.word);
            }

            function hoverNode(d) {
                d.node.hover();
            }
            function unhoverNode(d) {
                d.node.unhover();
            }

            let data = root.descendants();

            let node = el.selectAll('.node')
                .data(data, d => d.data.node);

            node.exit().remove();

            let nodeEnter = node.enter()
                .append('g')
                .attr('transform', (d) => 'translate(' + data[0].y + ',' + data[0].x + ')')
                .attr('class', (d) => 'node' + (d.children ? ' node--internal' : ' node--leaf') + (d.parent ? '' : ' node--root'));

            nodeEnter.append('path');   // symbol
            nodeEnter.append('text');   // label

            let nodeMerge = nodeEnter.merge(node);
            nodeMerge.transition()
                .attr('transform', (d) => 'translate(' + d.y + ',' + d.x + ')');

            nodeMerge
                .on('mouseover', function() {
                    d3.select(this).selectAll('.node--incoming')
                        .transition()
                        .attr('opacity', 1);
                })
                .on('mouseout', function() {
                    d3.select(this).selectAll('.node--incoming')
                        .transition()
                        .attr('opacity', 0.5);
                });

            nodeMerge.select('path')
                .attr('d', d3.symbol()
                    .type((d) => d.data.type === 'Word' ? (d.data.receivesArrow ? d3.symbolTriangle : d3.symbolSquare) : d3.symbolCircle)
                    .size(20)
                )
                .attr('transform', (d) => d.data.receivesArrow && d.data.type === 'Word' ? 'rotate(-30)' : 'rotate(45)')
                .attr('stroke', 'grey')
                .attr('fill', (d) => d.data.type === 'Word' ? 'black' : 'white')
                .on('mouseover', (d) => hoverNode.bind(this)(d.data))
                .on('mouseout', (d) => unhoverNode.bind(this)(d.data))
                .on('click', (d) => handleNodeClick.bind(this)(d.data));

            nodeMerge.select('text')
                .text((d) => d.data.name)
                .attr('fill', (d) => d.data.node.isSelected ? '#c37' : '#555')
                .attr('x', (d) => d.children ? -8 : 8)
                .attr('dy', (d) => {
                    if (!d.parent || !d.children) {
                        return 3;
                    }
                    else if (d.x === d.parent.x) {
                        return root.x > d.x ? -6 : 12;
                    }
                    return d.parent.x > d.x ? -6 : 12;
                })
                .style('text-anchor', (d) => d.children ? 'end' : 'start');

            let incoming = nodeMerge.selectAll('.node--incoming')
                .data((d) => d.data.incoming.map(node => {
                    return {
                        node,
                        anchor: d,
                        name: node instanceof Word ? node.val : node.textStr,
                        length: d.data.incoming.length
                    };
                }));

            incoming.exit().remove();
            let inEnter = incoming.enter()
                .append('g')
                    .attr('class','node--incoming')
                    .attr('opacity', 0.5);

            inEnter.append('path')
                .attr('fill','none')
                .attr('stroke', 'grey')
                .attr('stroke-dasharray', [2,2]);

            inEnter.append('circle')
                .attr('fill','grey')
                .attr('r',2.5);

            inEnter.append('text')
                .attr('fill','#da8000')
                .attr('dy',3)
                .attr('x', -8)
                .style('text-anchor','end');

            let inMerge = inEnter.merge(incoming)
                .attr('transform', (d, i) => 'translate(-30,' + (-15 * i - 25) + ')')
                .on('mouseover', (d) => hoverNode.bind(this)(d))
                .on('mouseout', (d) => unhoverNode.bind(this)(d))
                .on('click', (d) => handleNodeClick.bind(this)(d))
                .on('contextmenu', (d) => {
                    unhoverNode.bind(this)(d);
                    d3.event.preventDefault();
                    if (d.anchor.parent === null) {
                        handleNodeClick.bind(this)(d);
                    }
                    else {
                        this.updateIncoming(d, i);
                    }
                });

            inMerge.select('path')
                .attr('d', (d, i) => {
                    let dy = 15 * i + 25;
                    return 'M0,0, C30,0,30,' + dy + ',30,' + dy;
                });

            inMerge.select('text')
                .text(d => d.name);

        }
    }//end class TreeLayout

    return TreeLayout;
})();
