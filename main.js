//config
var capacity = 400;
var consumersCount = 1000;
var estimatePerSingleTable = 20;
var hoursOfService = 6;
var serviceMinUsage=15;
var serviceMaxUsage=25;
var predictionType=0;
var k = 0.5;
var displayByGroup = false;
var onlyWhoWaited = false;
var groups = undefined;

//internal
var estimatesPerTable={};
var estimatesPerGroupSize={};
var seatedClients=[];

function waitingTime(event, predictionType, clients, waitingList){
  var time=0, uid=event.uid;
	if(!clients[uid]){
		clients[uid] = {
			uid: uid,
			consumers : event.consumers,
			resources : getResourceCount(event.consumers)
		};
	}
	var client = clients[uid];
	client.status=event.status;
  //status = in
  if(client.status===0){
	client.checkin = event.timestamp;
	//served
	if(resourcesCount-client.resources>=0){
		client.served = client.checkin;
		resourcesCount -= client.resources;
		seatedClients.push(client);
	}
	//has to wait
	else{
	    var estimateBySingleTable=0, estimateByTables=0, estimateByGroupSize=0;
	    //then check also the queue

	    for(var i=0,l=waitingList.length;i<l;i++){
	        var waitingClient = waitingList[i];
            estimateBySingleTable += this.getEstimateForWaitingClient(0, waitingClient, client);
            estimateByTables += this.getEstimateForWaitingClient(1, waitingClient, client);
            estimateByGroupSize += this.getEstimateForWaitingClient(2, waitingClient, client);
	    }

		client.estimateBySingleTable = estimateBySingleTable;
		client.estimateByTables = estimateByTables;
		client.estimateByGroupSize = estimateByGroupSize;
		waitingList.push(client);

		switch(predictionType){
			case 1:
				time = client.estimateByTables;
				break;
			case 2:
				time = client.estimateByGroupSize;
				break;
			default:
				time = client.estimateBySingleTable;
		}

	}
	client.estimatedWaitingTime = time;
  }
  //status = out
  else {
	client.checkout = event.timestamp;
    seatedClients.splice(seatedClients.indexOf(client),1);
	//walked away
	if(!client.served){
		client.waitingTime = client.checkout - client.checkin;
	}
	else{
    	resourcesCount+=client.resources;

		client.waitingTime = client.served - client.checkin;

		//how much time the service took
		var serviceTime = client.checkout - client.served;
		if(serviceTime<0){
			console.log("something wrong with serviceTime " + serviceTime);
			serviceTime = 0;
		}
		//update estimate according to # of tables
		if(!estimatesPerTable[client.resources])
			estimatesPerTable[client.resources] = serviceTime;
		else
			estimatesPerTable[client.resources] = estimatesPerTable[client.resources] * (1-k) + serviceTime * k;
		//update estimate according to # of consumers
		if(!estimatesPerGroupSize[client.consumers])
			estimatesPerGroupSize[client.consumers] = serviceTime;
		else
			estimatesPerGroupSize[client.consumers] = estimatesPerGroupSize[client.consumers] * (1-k) + serviceTime * k;
		//single table avg waiting time
		estimatePerSingleTable = estimatePerSingleTable * (1-k) + (serviceTime/client.resources) * k;
	}
	if(client.estimatedWaitingTime>0){
		client.waitingTimeError = client.waitingTime - client.estimatedWaitingTime;
		client.estimateBySingleTableError = client.waitingTime - client.estimateBySingleTable;
		client.estimateByTablesError = client.waitingTime - client.estimateByTables;
		client.estimateByGroupSizeError = client.waitingTime - client.estimateByGroupSize;
	}

	//check if there are tables free for waiting people
	checkWaitingList(client.checkout, clients, waitingList);
  }
  return time;
}

function checkWaitingList(timestamp, clients, waitingList){
    var aIndexes = [];
	for(var i=0,l=waitingList.length;i<l && resourcesCount > 0;i++){
		var client = waitingList[i];
		if(resourcesCount - client.resources >= 0){
			//if client is still waiting
			if(client.status===0){
				resourcesCount -= client.resources;
				client.served = timestamp;
			}
			aIndexes.push(i);
		}
	}
	for(var i=aIndexes.length-1;i>=0;i--){
        waitingList.splice(i,1);
	}
}

function getResourceCount(consumers){
	return Math.max(Math.floor(consumers/2),1);
}

function getEstimateForWaitingClient(predictionType, waitingClient, newClient){
    var estimate = 0;
    var that = this;
    seatedClients.sort(function(a,b){
        var estimateA = that.estimate(a, predictionType),
        estimateB = that.estimate(b, predictionType),
        tlA = (a.served + estimateA - newClient.checkin),
        tlB = (b.served + estimateB - newClient.checkin);
        return ((tlA<tlB) ? -1 : (tlA>tlB) ? 1 : 0);
    });
    var resourcesNeeded = waitingClient.resources;
    for(var i=0,l=seatedClients.length;i<l && resourcesNeeded>0;i++){
        estimate += seatedClients[i].served - this.estimate(seatedClients[i], predictionType) - newClient.checkin;
        resourcesNeeded -= seatedClients[i].resources;
    }
    return estimate;
}

function estimate(client, predictionType){
    var estimate = estimatePerSingleTable * client.resources;
    switch(predictionType){
        case 1:
            estimate = estimatesPerTable[client.resources] || estimate;
            break;
        case 2:
            estimate = estimatesPerTable[client.consumers] || estimate;
            break;
    }
    return estimate;
}

//Test

function simulate(newEvents){
	var nCapacity = parseInt($("#capacity").val());
	var nConsumersCount = parseInt($("#consumersCount").val());

    newEvents = newEvents || !groups || nCapacity !== capacity || nConsumersCount !== consumersCount;

    capacity = nCapacity;
    consumersCount = nConsumersCount;
	resourcesCount = getResourceCount(capacity);
	estimatePerSingleTable = parseInt($("#estimatePerSingleTable").val());
	hoursOfService = parseInt($("#hoursOfService").val());
	serviceMinUsage = parseInt($("#serviceMinUsage").val());
	serviceMaxUsage = parseInt($("#serviceMaxUsage").val());
	k = parseFloat($("#k").val());
	predictionType = parseInt($("#predictionType").val());

	$("#ctrl").html("");
	start(newEvents, predictionType);
}

function changeDisplayByGroup(cb){
	displayByGroup = cb.checked;
	render();
}

function changeOnlyWhoWaited(cb){
	onlyWhoWaited = cb.checked;
	render();
}

function printHour(timestamp){
	var hours = Math.floor(timestamp/60);
	var time = hours + (timestamp - hours*60)/100;
	return time.toFixed(2).replace(".", ":");
}

function printMinute(timestamp){
	var ts = timestamp ? timestamp.toFixed(3) : 0;
	return parseFloat(ts) === timestamp ? timestamp : ts;
}

function start(newEvents, predictionType){
    if(newEvents){
        groups = generateGroups();
    	events = generateEvents(groups);
    }

	//internal
	estimatesPerTable={};
	estimatesPerGroupSize={};
	clients = {};

	clients = processEvents(events, predictionType);

	var groupsThatWaited = [];
	var totWaitingTime = 0;
	var totEstimatedWaitingTime = 0;
	var totWaitingTimeError = 0;
	for(var i=0,l=groups.length;i<l;i++){
		var group = groups[i];
		var waitingTime = group.served - group.checkin;
		if(waitingTime>0){
			group.waitingTime = waitingTime;
			group.estimatedWaitingTime = clients[group.uid].estimatedWaitingTime;
			group.wtErr = clients[group.uid].waitingTimeError;
			group.wtRealErr = (waitingTime - group.estimatedWaitingTime);

			totWaitingTime += group.waitingTime;
			totEstimatedWaitingTime += group.estimatedWaitingTime;
			totWaitingTimeError += group.wtRealErr;

			groupsThatWaited.push(group);
		}
	}
	var avgWaitingTime = totWaitingTime/groupsThatWaited.length;
	var avgEstimatedWaitingTime = totEstimatedWaitingTime/groupsThatWaited.length;
	var avgWaitingTimeErr = totWaitingTimeError/groupsThatWaited.length;
	$("#ctrl").append(groupsThatWaited.length + "/" + groups.length + " groups waited in avg " +printMinute(avgWaitingTime)+ ", estimated avg "+printMinute(avgEstimatedWaitingTime)+", error avg "+printMinute(avgWaitingTimeErr)+"<br><br>");
	for(var i=0,l=groupsThatWaited.length;i<l;i++){
		$("#ctrl").append(JSON.stringify(groupsThatWaited[i])+ "<br>");
	}
	$("#ctrl").append("<br>estimatePerSingleTable " +estimatePerSingleTable+ "<br>");
	$("#ctrl").append("estimatesPerTable " +JSON.stringify(estimatesPerTable)+ "<br/>");
	$("#ctrl").append("estimatesPerGroupSize " +JSON.stringify(estimatesPerGroupSize));

	render();
}

function generateGroups(){
	var groups = [];
	var remainingPeople = consumersCount;
	while(remainingPeople>0){
		var i = groups.length;
		var consumers = Math.min(Math.floor(Math.random() * 4) + 1, remainingPeople);
		var tsStart = Math.floor(Math.random() * 60 * hoursOfService/2) + Math.floor(Math.random() * 60 * hoursOfService/2);
		var serviceUsage = serviceMinUsage + Math.floor(Math.random() * (serviceMaxUsage-serviceMinUsage));
		groups.push({
			uid: i,
			consumers: consumers,
			checkin: tsStart,
			serviceUsage: serviceUsage
		});
		remainingPeople-=consumers;
	}
	groups.sort(function(a,b){
		return ((a.checkin<b.checkin) ? -1 : (a.checkin>b.checkin) ? 1 : 0);
	});
	var totalCapacity = capacity;
	var queue = [];
	var seated = [];
	for(var i=0;i<groups.length;i++){
		var ci = groups[i].checkin;

		var aSeatedIndexes = [];
        //check if someone went away
        for(var j=0,l=seated.length;j<l;j++){
            var groupOut = seated[j];
            if(groupOut.checkout<=ci){
                totalCapacity += groupOut.consumers;
                console.log("checkout " + JSON.stringify(groupOut));
                aSeatedIndexes.push(j);
                //check the queue for someone to seat
                var aQueueIndexes = [];
                for(var k=0;k<queue.length && totalCapacity>0;k++){
                    var groupQueue = queue[k];
                    if(totalCapacity-groupQueue.consumers>=0){
                        totalCapacity -= groupQueue.consumers;
                        aQueueIndexes.push(k);
                        groupQueue.served = ci;
                        group.checkout = groupQueue.served + groupQueue.serviceUsage;
                        console.log("served " + JSON.stringify(groupQueue));
                        seated.push(group);
                    }
                }
                for(var k=aQueueIndexes.length-1; k>=0;k--){
                    queue.splice(aQueueIndexes[k],1);
                }
            }
        }
        for(var j=aSeatedIndexes.length-1; j>=0;j--){
            seated.splice(aSeatedIndexes[j],1);
        }

        var group = groups[i];
		if(totalCapacity-group.consumers>=0){
			totalCapacity -= group.consumers;
			group.served = group.checkin;
			group.checkout = group.served + group.serviceUsage;
			seated.push(group);
			console.log("checkin " + JSON.stringify(group));
		}
		else{
			queue.push(group);
		}
	}
	while(queue.length || seated.length){
	    if(seated.length){
	        //sort by who will go away first
            seated.sort(function(a,b){
                return ((a.checkout<b.checkout) ? -1 : (a.checkout>b.checkout) ? 1 : 0);
            });
            var groupOut = seated[0];
            totalCapacity += groupOut.consumers;
            console.log("checkout " + JSON.stringify(groupOut));
            seated.splice(0,1);
	    }
		for(var i=0;i<queue.length;i++){
			var group = queue[i];
			if(totalCapacity-group.consumers>=0){
				totalCapacity -= group.consumers;
				group.served = Math.max(groupOut.checkout, group.checkin);
				group.checkout = group.served + group.serviceUsage;
				var sMsg = groupOut.checkout>group.checkin ? "served " : "checkin ";
				console.log(sMsg + JSON.stringify(group));
				seated.push(group);
				queue.splice(i,1);
				break;
			}
		}
	}

	return groups;
}

function generateEvents(groups){
	var events = [];
	for(var i=0;i<groups.length;i++){
		var group = groups[i];
		events.push({uid:group.uid, consumers:group.consumers, timestamp:group.checkin, status:0});
		events.push({uid:group.uid, consumers:group.consumers, timestamp:group.checkout, status:1});
	}
	events.sort(function(a,b){
		return ((a.timestamp<b.timestamp) ? -1 : (a.timestamp>b.timestamp) ? 1 : 0);
	});
	return events;
}

function processEvents(events, predictionType){
	var groups = {};
	var waitingList = [];
	//calculate waiting times and print waiting times
	for(var i=0,l=events.length;i<l;i++){
		var event = events[i];
		waitingTime(event, predictionType, groups, waitingList);
	}
	return groups;
}

function render(){
	$("#log").html("");
	if(displayByGroup){
		for(var i=0, l=groups.length;i<l;i++){
			var group = groups[i];

			var client = clients[group.uid];
			var sRow = "<p>#" + group.uid + " (" + group.consumers +"p) " + printHour(group.checkin) + " to " + printHour(group.checkout) + " ("+printMinute(group.checkout-group.checkin)+"min)";
			if(!client.served){
				sRow += ", went away";
			}
			else if(group.served !== group.checkin){
				sRow += ", served at " + printHour(client.served) + "("+ printHour(group.served) + ")";
			}
			if(group.estimatedWaitingTime>0){
				sRow += ", waited " + printMinute(group.waitingTime) + ", forecast " + printMinute(group.estimatedWaitingTime) + ", error " + printMinute((client.waitingTimeError)) + "<br>";
				sRow += "--- forecast " + printMinute(client.estimateBySingleTable) + ", error " + printMinute((client.estimateBySingleTableError)) + " (estimateBySingleTable) <br>";
				sRow += "--- forecast " + printMinute(client.estimateByTables) + ", error " + printMinute((client.estimateByTablesError)) + " (estimateByTables)<br>";
				sRow += "--- forecast " + printMinute(client.estimateByGroupSize) + ", error " + printMinute((client.estimateByGroupSizeError)) + " (estimateByGroupSize)";
			}
			if(onlyWhoWaited === false || client.estimatedWaitingTime>0)
    			$("#log").append(sRow + "</p>");
		}
	}
	else{
		for(var i=0,l=events.length;i<l;i++){
			var event = events[i];
			var client = clients[event.uid];

			//print event
			var sRow = "<p>" + printHour(event.timestamp) + " - " + (event.status===0 ? "checkin" : client.served>0 ? "checkout" : "didnt wait") + " #" +client.uid + " (" + client.consumers +"p, "+client.resources+"t)";
			if(event.status === 0 && client.estimatedWaitingTime>0){
				sRow += ", waiting estimate " + printMinute(client.estimatedWaitingTime) + "min";
			}
			else if(event.status===1 && client.estimatedWaitingTime>0){
				sRow +=", waited "+ printMinute(client.waitingTime) + ", estimate "+ printMinute(client.estimatedWaitingTime) + ", error "+ printMinute(client.waitingTimeError) + "<br>";
				sRow += "--- forecast " + printMinute(client.estimateBySingleTable) + ", error " + printMinute((client.estimateBySingleTableError)) + " (estimateBySingleTable) <br>";
				sRow += "--- forecast " + printMinute(client.estimateByTables) + ", error " + printMinute((client.estimateByTablesError)) + " (estimateByTables)<br>";
				sRow += "--- forecast " + printMinute(client.estimateByGroupSize) + ", error " + printMinute((client.estimateByGroupSizeError)) + " (estimateByGroupSize)";
			}
			else if(event.status===1){
				sRow +=", stayed "+ printMinute(client.checkout-client.served) + "min";
			}
			if(onlyWhoWaited === false || client.estimatedWaitingTime>0)
			    $("#log").append(sRow + "</p>");
		}
	}
}

simulate();