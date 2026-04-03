const Category = require("../models/category.model")
const categoryTree = (categoryList, idParent = "")=>{
    const tree = []
    categoryList.forEach(item => {
        if(idParent == item.parent){
            const children = categoryTree(categoryList,item.id);
            tree.push({
                id: item.id,
                name: item.name,
                slug:item.slug,
                children: children
        })}
            
    })
    return tree;
}
module.exports.categoryTree = categoryTree;

module.exports.categoryChild = async (idParent)=>{
    const childArray = [idParent]
    const findChild = async (idparent)=>{
        const childList = await Category.find({
            deleted:false,
            parent: idparent
        })
        for(const item of childList){
            childArray.push(item.id)
            await findChild(item.id)
        }
    }
    await findChild(idParent)

    return childArray;
}

module.exports.categoryParent = async (idParent)=>{
    const ids = [idParent]
    const findParent = async (idParent)=>{
        const parent= await Category.findOne({
            _id:idParent,
            deleted:false
        })
        if (parent && parent.parent) {
            ids.push(parent.parent)
            await findParent(parent.parent)
        }
    }
    await findParent(idParent)
    return ids
}